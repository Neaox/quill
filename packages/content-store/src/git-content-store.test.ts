import type { ContentChange, PublishResult, PutFileResult } from '@quill/application'
import { revisionId, type DocumentId, type RevisionId, type WorkspaceId } from '@quill/domain'
import { beforeEach, describe, expect, it } from 'vitest'

import { CHANGE_NOTE_TRAILER, DOCUMENT_ID_TRAILER } from './branding.ts'
import { ContentStoreError, GitContentStore, type HistorySlice } from './git-content-store.ts'
import { parseTrailers, trailerValues } from './git/trailers.ts'
import { MemoryObjectStore, MemoryObjectStoreProvider } from './memory-object-store.ts'
import type { ObjectEntry, ObjectStore, ObjectStoreProvider } from './object-store.ts'
import {
  AUTHOR,
  JITTER,
  markdown,
  newDocument,
  newWorkspaceId,
  NOW,
  write,
} from './test-fixtures.ts'

const ONBOARDING = newDocument()
const ARCHITECTURE = newDocument()

let provider: MemoryObjectStoreProvider
let store: GitContentStore
let workspace: WorkspaceId

beforeEach(() => {
  provider = new MemoryObjectStoreProvider()
  store = new GitContentStore({ provider, now: NOW, random: JITTER })
  workspace = newWorkspaceId()
})

function published(result: PublishResult): RevisionId {
  if (result.kind !== 'published') throw new Error(`Expected a revision, got ${result.kind}`)
  return result.revision
}

function writtenRevision(result: PutFileResult): RevisionId {
  if (result.kind !== 'published') throw new Error(`Expected a revision, got ${result.kind}`)
  return result.revision
}

async function publish(
  changes: readonly ContentChange[],
  base: RevisionId | null,
  extra: { summary?: string; changeNote?: string } = {},
): Promise<PublishResult> {
  return await store.publish({ workspaceId: workspace, changes, author: AUTHOR, base, ...extra })
}

async function publishDocument(
  id: DocumentId,
  path: string,
  title: string,
  body: string,
  base: RevisionId | null,
): Promise<RevisionId> {
  return published(await publish([write(id, path, markdown(id, title, body))], base))
}

describe('head', () => {
  it('is null before a workspace has any revisions', async () => {
    expect(await store.head(workspace)).toBeNull()
  })

  it('is the revision of the last publish', async () => {
    const revision = await publishDocument(ONBOARDING, 'onboarding.md', 'Onboarding', 'One.', null)
    expect(await store.head(workspace)).toBe(revision)
  })
})

describe('publish and read', () => {
  it('reads a document back by its id, not its path', async () => {
    await publishDocument(ONBOARDING, 'handbook/onboarding.md', 'Onboarding', 'One.', null)
    expect(await store.read(workspace, ONBOARDING)).toMatchObject({
      documentId: ONBOARDING,
      path: 'handbook/onboarding.md',
    })
  })

  it('returns null for a workspace with no revisions', async () => {
    expect(await store.read(workspace, ONBOARDING)).toBeNull()
  })

  it('returns null for a document that is not in the revision', async () => {
    await publishDocument(ONBOARDING, 'onboarding.md', 'Onboarding', 'One.', null)
    expect(await store.read(workspace, ARCHITECTURE)).toBeNull()
  })

  it('walks past files that are not documents while looking for one', async () => {
    await publish(
      [
        write(ARCHITECTURE, 'assets/diagram.svg', '<svg />'),
        write(ONBOARDING, 'handbook/onboarding.md', markdown(ONBOARDING, 'Onboarding')),
      ],
      null,
    )
    expect(await store.read(workspace, ONBOARDING)).toMatchObject({
      path: 'handbook/onboarding.md',
    })
  })

  it('reads a document as it was at an earlier revision', async () => {
    const first = await publishDocument(ONBOARDING, 'onboarding.md', 'Onboarding', 'One.', null)
    await publishDocument(ONBOARDING, 'onboarding.md', 'Onboarding', 'Two.', first)
    expect((await store.read(workspace, ONBOARDING, first))?.markdown).toContain('One.')
    expect((await store.read(workspace, ONBOARDING))?.markdown).toContain('Two.')
  })

  it('has nothing to read at a revision the store no longer holds', async () => {
    await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const vanished = revisionId('c'.repeat(40))
    expect(await store.read(workspace, ONBOARDING, vanished)).toBeNull()
    expect(await store.listTree(workspace, vanished)).toEqual([])
    expect(await store.history(workspace, ONBOARDING, { limit: 10, cursor: vanished })).toEqual([])
  })

  it('has nothing to read at a revision that is not a commit', async () => {
    const revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const objects = await provider.forWorkspace(workspace)
    const tree = decodeTreeOid(await commitObject(objects, revision))
    expect(await store.read(workspace, ONBOARDING, revisionId(tree))).toBeNull()
    expect(await store.listTree(workspace, revisionId(tree))).toEqual([])
  })

  it('refuses a publish that changes nothing', async () => {
    await expect(publish([], null)).rejects.toThrow(ContentStoreError)
  })

  it('normalises paths to NFC so one name is one tree entry', async () => {
    const decomposed = `Gro${String.fromCodePoint(0x0308)}ße.md`
    await publishDocument(ONBOARDING, decomposed, 'Größe', 'One.', null)
    expect((await store.read(workspace, ONBOARDING))?.path).toBe('Größe.md')
  })

  it('records the author as the author and the product as the committer', async () => {
    const revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const [summary] = await store.history(workspace, ONBOARDING, { limit: 1 })
    expect(summary).toMatchObject({ revision, author: AUTHOR })
    expect(summary?.timestamp).toEqual(new Date('2026-09-12T10:00:00Z'))
  })
})

describe('publish of several changes', () => {
  it('makes one revision out of a bulk change', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const revision = published(
      await publish(
        [
          write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding', 'Two.')),
          write(ARCHITECTURE, 'b.md', markdown(ARCHITECTURE, 'Architecture', 'New.')),
        ],
        first,
      ),
    )
    const summaries = await store.history(workspace, ARCHITECTURE, { limit: 10 })
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.documentIds).toEqual([ONBOARDING, ARCHITECTURE])
    expect(await store.head(workspace)).toBe(revision)
  })

  it('moves a document, carrying its content to the new path', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publish(
      [{ kind: 'move', documentId: ONBOARDING, fromPath: 'a.md', toPath: 'handbook/b.md' }],
      first,
    )
    const found = await store.read(workspace, ONBOARDING)
    expect(found).toMatchObject({ path: 'handbook/b.md' })
    expect(found?.markdown).toContain('One.')
    expect(await store.listTree(workspace)).toHaveLength(1)
  })

  it('moves a document and changes it in the same revision', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publish(
      [
        {
          kind: 'move',
          documentId: ONBOARDING,
          fromPath: 'a.md',
          toPath: 'b.md',
          markdown: markdown(ONBOARDING, 'Onboarding', 'Two.'),
        },
      ],
      first,
    )
    expect((await store.read(workspace, ONBOARDING))?.markdown).toContain('Two.')
  })

  it('tolerates a move of a document that is not there', async () => {
    const change: ContentChange = {
      kind: 'move',
      documentId: ONBOARDING,
      fromPath: 'a.md',
      toPath: 'b.md',
    }
    published(await publish([change], null))
    expect(await store.listTree(workspace)).toEqual([])
  })

  it('deletes a document, leaving it readable at earlier revisions', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publish([{ kind: 'delete', documentId: ONBOARDING, path: 'a.md' }], first)
    expect(await store.read(workspace, ONBOARDING)).toBeNull()
    expect(await store.read(workspace, ONBOARDING, first)).not.toBeNull()
  })
})

describe('commit messages', () => {
  it('uses the summary the caller gave as the subject line', async () => {
    const revision = published(
      await publish([write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding'))], null, {
        summary: 'Restore Onboarding',
      }),
    )
    const [entry] = await store.history(workspace, ONBOARDING, { limit: 1 })
    expect(entry).toMatchObject({ revision, summary: 'Restore Onboarding' })
  })

  it('folds a multi-line change note onto one trailer line', async () => {
    await publish([write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding'))], null, {
      changeNote: 'Rewrote the introduction.\n\nAlso fixed a typo.',
    })
    const [entry] = await store.history(workspace, ONBOARDING, { limit: 1 })
    expect(entry?.changeNote).toBe('Rewrote the introduction. Also fixed a typo.')
  })

  it('leaves the change note out when there is none', async () => {
    await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const [entry] = await store.history(workspace, ONBOARDING, { limit: 1 })
    expect(entry?.changeNote).toBeUndefined()
  })

  it('carries the trailers a rebuilt revisions index needs', async () => {
    const revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const objects = await provider.forWorkspace(workspace)
    const message = await commitMessage(objects, revision)
    const trailers = parseTrailers(message)
    expect(trailerValues(trailers, DOCUMENT_ID_TRAILER)).toEqual([ONBOARDING])
    expect(trailerValues(trailers, CHANGE_NOTE_TRAILER)).toEqual([])
  })
})

describe('stale base', () => {
  it('merges edits to different parts of a document', async () => {
    const first = await publishDocument(
      ONBOARDING,
      'a.md',
      'Onboarding',
      'one\ntwo\nthree\nfour\nfive',
      null,
    )
    await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'one\ntwo\nthree\nfour\nFIVE', first)
    const result = await publish(
      [
        write(
          ONBOARDING,
          'a.md',
          markdown(ONBOARDING, 'Onboarding', 'ONE\ntwo\nthree\nfour\nfive'),
        ),
      ],
      first,
    )
    expect(result.kind).toBe('published')
    const merged = (await store.read(workspace, ONBOARDING))?.markdown ?? ''
    expect(merged).toContain('ONE')
    expect(merged).toContain('FIVE')
  })

  it('reports a conflict instead of overwriting', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'original', null)
    const second = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'theirs', first)
    const result = await publish(
      [write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding', 'ours'))],
      first,
    )
    expect(result).toMatchObject({ kind: 'merge-required', current: second })
    if (result.kind !== 'merge-required') throw new Error('expected a merge')
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ documentId: ONBOARDING, path: 'a.md' })
    expect(result.conflicts[0]?.conflicted).toContain('<<<<<<<')
    expect(result.conflicts[0]?.ours).toContain('ours')
    expect(result.conflicts[0]?.theirs).toContain('theirs')
    expect(result.conflicts[0]?.base).toContain('original')
    expect(await store.head(workspace)).toBe(second)
  })

  it('does not merge when the other publish touched another document', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publishDocument(ARCHITECTURE, 'b.md', 'Architecture', 'Other.', first)
    const result = await publish(
      [write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding', 'Two.'))],
      first,
    )
    expect(result.kind).toBe('published')
    expect((await store.read(workspace, ONBOARDING))?.markdown).toContain('Two.')
  })

  it('accepts a publish whose content already matches the head', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const second = await publishDocument(ARCHITECTURE, 'b.md', 'Architecture', 'Other.', first)
    const result = await publish(
      [write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding', 'One.'))],
      first,
    )
    expect(result.kind).toBe('published')
    expect(await store.head(workspace)).not.toBe(second)
  })

  it('deletes a document nobody has touched since the base', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publishDocument(ARCHITECTURE, 'b.md', 'Architecture', 'Other.', first)
    const result = await publish([{ kind: 'delete', documentId: ONBOARDING, path: 'a.md' }], first)
    expect(result.kind).toBe('published')
    expect(await store.read(workspace, ONBOARDING)).toBeNull()
  })

  it('asks a human before a delete discards someone else’s edit', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'Two.', first)
    const result = await publish([{ kind: 'delete', documentId: ONBOARDING, path: 'a.md' }], first)
    expect(result.kind).toBe('merge-required')
    if (result.kind !== 'merge-required') throw new Error('expected a merge')
    expect(result.conflicts[0]).toMatchObject({ documentId: ONBOARDING, ours: '' })
    expect(result.conflicts[0]?.theirs).toContain('Two.')
    expect(await store.read(workspace, ONBOARDING)).not.toBeNull()
  })

  it('asks a human before an edit revives a document someone else deleted', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publish([{ kind: 'delete', documentId: ONBOARDING, path: 'a.md' }], first)
    const result = await publish(
      [write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding', 'Two.'))],
      first,
    )
    expect(result.kind).toBe('merge-required')
    if (result.kind !== 'merge-required') throw new Error('expected a merge')
    expect(result.conflicts[0]).toMatchObject({ documentId: ONBOARDING, theirs: '' })
    expect(result.conflicts[0]?.ours).toContain('Two.')
  })

  it('follows a document somebody else moved rather than duplicating it', async () => {
    const first = await publishDocument(
      ONBOARDING,
      'a.md',
      'Onboarding',
      'one\ntwo\nthree\nfour\nfive',
      null,
    )
    await publish(
      [{ kind: 'move', documentId: ONBOARDING, fromPath: 'a.md', toPath: 'handbook/a.md' }],
      first,
    )
    const result = await publish(
      [
        write(
          ONBOARDING,
          'a.md',
          markdown(ONBOARDING, 'Onboarding', 'ONE\ntwo\nthree\nfour\nfive'),
        ),
      ],
      first,
    )
    expect(result.kind).toBe('published')
    expect(await store.listTree(workspace)).toEqual([
      { path: 'handbook/a.md', kind: 'document', documentId: ONBOARDING },
    ])
    expect((await store.read(workspace, ONBOARDING))?.markdown).toContain('ONE')
  })

  it('moves a document from wherever somebody else left it', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publish(
      [{ kind: 'move', documentId: ONBOARDING, fromPath: 'a.md', toPath: 'handbook/a.md' }],
      first,
    )
    const result = await publish(
      [{ kind: 'move', documentId: ONBOARDING, fromPath: 'a.md', toPath: 'runbooks/a.md' }],
      first,
    )
    expect(result.kind).toBe('published')
    expect((await store.listTree(workspace)).map((entry) => entry.path)).toEqual(['runbooks/a.md'])
  })

  it('deletes a document from wherever somebody else moved it', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publish(
      [{ kind: 'move', documentId: ONBOARDING, fromPath: 'a.md', toPath: 'handbook/a.md' }],
      first,
    )
    const result = await publish([{ kind: 'delete', documentId: ONBOARDING, path: 'a.md' }], first)
    expect(result.kind).toBe('published')
    expect(await store.listTree(workspace)).toEqual([])
  })

  it('merges a move that carries content into the path it ended up at', async () => {
    const first = await publishDocument(
      ONBOARDING,
      'a.md',
      'Onboarding',
      'one\ntwo\nthree\nfour\nfive',
      null,
    )
    await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'one\ntwo\nthree\nfour\nFIVE', first)
    const result = await publish(
      [
        {
          kind: 'move',
          documentId: ONBOARDING,
          fromPath: 'a.md',
          toPath: 'handbook/a.md',
          markdown: markdown(ONBOARDING, 'Onboarding', 'ONE\ntwo\nthree\nfour\nfive'),
        },
      ],
      first,
    )
    expect(result.kind).toBe('published')
    const found = await store.read(workspace, ONBOARDING)
    expect(found?.path).toBe('handbook/a.md')
    expect(found?.markdown).toContain('ONE')
    expect(found?.markdown).toContain('FIVE')
  })

  it('asks a human before a move revives a document someone else deleted', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publish([{ kind: 'delete', documentId: ONBOARDING, path: 'a.md' }], first)
    const result = await publish(
      [
        {
          kind: 'move',
          documentId: ONBOARDING,
          fromPath: 'a.md',
          toPath: 'handbook/a.md',
          markdown: markdown(ONBOARDING, 'Onboarding', 'Two.'),
        },
      ],
      first,
    )
    expect(result.kind).toBe('merge-required')
    if (result.kind !== 'merge-required') throw new Error('expected a merge')
    expect(result.conflicts[0]).toMatchObject({ path: 'handbook/a.md', theirs: '' })
  })

  it('treats a publish with no base at all as maximally stale', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    expect(first).not.toBe('')
    const result = await publish(
      [write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding', 'Two.'))],
      null,
    )
    expect(result.kind).toBe('merge-required')
  })

  it('treats a base the store no longer holds as maximally stale', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publishDocument(ARCHITECTURE, 'b.md', 'Architecture', 'Other.', first)
    const result = await publish(
      [write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding', 'Two.'))],
      revisionId('c'.repeat(40)),
    )
    expect(result.kind).toBe('merge-required')
  })

  it('merges a document that is new to the head against an empty ancestor', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publishDocument(ARCHITECTURE, 'b.md', 'Architecture', 'theirs', first)
    const result = await publish(
      [write(ARCHITECTURE, 'b.md', markdown(ARCHITECTURE, 'Architecture', 'ours'))],
      first,
    )
    expect(result.kind).toBe('merge-required')
  })
})

describe('history', () => {
  it('is empty for a workspace with no revisions', async () => {
    expect(await store.history(workspace, ONBOARDING, { limit: 10 })).toEqual([])
  })

  it('lists a document’s revisions, newest first', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const second = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'Two.', first)
    const third = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'Three.', second)
    const summaries = await store.history(workspace, ONBOARDING, { limit: 10 })
    expect(summaries.map((entry) => entry.revision)).toEqual([third, second, first])
  })

  it('leaves out revisions that did not touch the document', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const second = await publishDocument(ARCHITECTURE, 'b.md', 'Architecture', 'Other.', first)
    await publishDocument(ARCHITECTURE, 'b.md', 'Architecture', 'Again.', second)
    const summaries = await store.history(workspace, ONBOARDING, { limit: 10 })
    expect(summaries.map((entry) => entry.revision)).toEqual([first])
  })

  it('stops at the limit', async () => {
    let revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    for (const body of ['Two.', 'Three.', 'Four.']) {
      revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', body, revision)
    }
    expect(await store.history(workspace, ONBOARDING, { limit: 2 })).toHaveLength(2)
  })

  it('resumes after the cursor, with no overlap', async () => {
    let revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const revisions = [revision]
    for (const body of ['Two.', 'Three.', 'Four.']) {
      revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', body, revision)
      revisions.push(revision)
    }
    const page = await store.history(workspace, ONBOARDING, { limit: 2 })
    const next = await store.history(workspace, ONBOARDING, {
      limit: 2,
      cursor: page[1]!.revision,
    })
    expect([...page, ...next].map((entry) => entry.revision)).toEqual(revisions.toReversed())
  })

  it('has nothing left after the cursor reaches the first revision', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    expect(await store.history(workspace, ONBOARDING, { limit: 2, cursor: first })).toEqual([])
  })

  it('has nothing left for a cursor whose revision the store does not hold', async () => {
    await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const missing = 'c'.repeat(40)
    expect(await store.history(workspace, ONBOARDING, { limit: 2, cursor: missing })).toEqual([])
  })

  it('has nothing to walk when the ref points at something that is not a commit', async () => {
    const revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const objects = await provider.forWorkspace(workspace)
    const tree = decodeTreeOid(await commitObject(objects, revision))
    await objects.casRef('refs/heads/main', revision, tree)
    expect(await store.history(workspace, ONBOARDING, { limit: 10 })).toEqual([])
  })

  it('refuses a cursor that is not a revision, so no path can escape', async () => {
    await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await expect(
      store.history(workspace, ONBOARDING, { limit: 2, cursor: '../../../etc/passwd' }),
    ).rejects.toThrow(/Invalid RevisionId/)
  })

  it.each([0, -1, 1.5])('refuses a limit of %s', async (limit) => {
    await expect(store.history(workspace, ONBOARDING, { limit })).rejects.toThrow(ContentStoreError)
  })

  it('refuses a scan limit that would scan nothing', async () => {
    await expect(store.history(workspace, ONBOARDING, { limit: 1, scanLimit: 0 })).rejects.toThrow(
      /scan limit/,
    )
  })

  it('stops at the scan budget and says where to resume', async () => {
    let revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    for (const body of ['Two.', 'Three.', 'Four.', 'Five.']) {
      revision = await publishDocument(ARCHITECTURE, 'b.md', 'Architecture', body, revision)
    }
    const page = await store.historySlice(workspace, ONBOARDING, { limit: 10, scanLimit: 2 })
    expect(page.revisions).toEqual([])
    expect(page.cursor).not.toBeNull()
    const rest = await store.historySlice(workspace, ONBOARDING, {
      limit: 10,
      scanLimit: 10,
      ...(page.cursor === null ? {} : { cursor: page.cursor }),
    })
    expect(rest.revisions.map((entry) => entry.summary)).toEqual(['Update Onboarding'])
    expect(rest.cursor).toBeNull()
  })

  it('finds a revision deep in a history, one budgeted page at a time', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    let revision = first
    for (let index = 0; index < 9; index += 1) {
      revision = await publishDocument(ARCHITECTURE, 'b.md', 'Architecture', `${index}`, revision)
    }
    const found: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 10; page += 1) {
      const slice: HistorySlice = await store.historySlice(workspace, ONBOARDING, {
        limit: 10,
        scanLimit: 2,
        ...(cursor === null ? {} : { cursor }),
      })
      found.push(...slice.revisions.map((entry) => entry.revision))
      cursor = slice.cursor
      if (cursor === null) break
    }
    expect(found).toEqual([first])
  })

  it('follows a document through a move', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const second = published(
      await publish(
        [{ kind: 'move', documentId: ONBOARDING, fromPath: 'a.md', toPath: 'b/c.md' }],
        first,
      ),
    )
    const summaries = await store.history(workspace, ONBOARDING, { limit: 10 })
    expect(summaries.map((entry) => entry.revision)).toEqual([second, first])
  })

  it('still has the history of a deleted document', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const second = published(
      await publish([{ kind: 'delete', documentId: ONBOARDING, path: 'a.md' }], first),
    )
    const summaries = await store.history(workspace, ONBOARDING, { limit: 10 })
    expect(summaries.map((entry) => entry.revision)).toEqual([second, first])
  })
})

describe('diff', () => {
  it('shows a new document as all additions', async () => {
    const revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const diff = await store.diff(workspace, ONBOARDING, null, revision)
    expect(diff).toMatchObject({ documentId: ONBOARDING, from: null, to: revision, removed: 0 })
    expect(diff.added).toBeGreaterThan(0)
    expect(diff.unified).toContain('--- a/a.md')
  })

  it('shows what changed between two revisions', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const second = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'Two.', first)
    const diff = await store.diff(workspace, ONBOARDING, first, second)
    expect(diff.unified).toContain('-One.')
    expect(diff.unified).toContain('+Two.')
    expect(diff).toMatchObject({ added: 1, removed: 1 })
  })

  it('shows a delete as all removals', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const second = published(
      await publish([{ kind: 'delete', documentId: ONBOARDING, path: 'a.md' }], first),
    )
    const diff = await store.diff(workspace, ONBOARDING, first, second)
    expect(diff.added).toBe(0)
    expect(diff.removed).toBeGreaterThan(0)
  })

  it('names the document when neither revision holds it', async () => {
    const revision = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    const diff = await store.diff(workspace, ARCHITECTURE, null, revision)
    expect(diff).toMatchObject({ unified: '', added: 0, removed: 0 })
  })
})

describe('listTree', () => {
  it('is empty for a workspace with no revisions', async () => {
    expect(await store.listTree(workspace)).toEqual([])
  })

  it('describes documents, assets, and everything else', async () => {
    await publish(
      [
        write(ONBOARDING, 'handbook/onboarding.md', markdown(ONBOARDING, 'Onboarding')),
        write(ARCHITECTURE, 'assets/diagram.svg', '<svg />'),
        write(ARCHITECTURE, '.quill/workspace.yaml', 'schema: 1\n'),
        write(ARCHITECTURE, 'untitled.md', '# No front matter\n'),
      ],
      null,
    )
    expect(await store.listTree(workspace)).toEqual([
      { path: '.quill/workspace.yaml', kind: 'other' },
      { path: 'assets/diagram.svg', kind: 'asset' },
      { path: 'handbook/onboarding.md', kind: 'document', documentId: ONBOARDING },
      { path: 'untitled.md', kind: 'document' },
    ])
  })

  it('lists the tree of an earlier revision', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await publishDocument(ARCHITECTURE, 'b.md', 'Architecture', 'Other.', first)
    expect(await store.listTree(workspace, first)).toHaveLength(1)
    expect(await store.listTree(workspace)).toHaveLength(2)
  })
})

describe('compare-and-swap', () => {
  it('retries with jittered backoff when it loses the race', async () => {
    const slept: number[] = []
    const contended = new ContendedProvider(2)
    const retrying = new GitContentStore({
      provider: contended,
      now: NOW,
      sleep: async (ms) => void slept.push(ms),
      random: () => 0.5,
    })
    const result = await retrying.publish({
      workspaceId: workspace,
      changes: [write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding'))],
      author: AUTHOR,
      base: null,
    })
    expect(result.kind).toBe('published')
    expect(slept).toEqual([2, 3])
  })

  it('gives up after the attempt limit rather than spinning', async () => {
    const retrying = new GitContentStore({
      provider: new ContendedProvider(Number.POSITIVE_INFINITY),
      now: NOW,
      random: JITTER,
      sleep: async () => undefined,
      maxPublishAttempts: 3,
    })
    await expect(
      retrying.publish({
        workspaceId: workspace,
        changes: [write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding'))],
        author: AUTHOR,
        base: null,
      }),
    ).rejects.toThrow(/lost 3 compare-and-swap races/)
  })

  it('lets eight concurrent publishers into one workspace all succeed', async () => {
    const first = await publishDocument(ONBOARDING, 'seed.md', 'Seed', 'Seed.', null)
    const ids = Array.from({ length: 8 }, () => newDocument())
    const results = await Promise.all(
      ids.map((id, index) =>
        publish([write(id, `docs/${index}.md`, markdown(id, `Document ${index}`))], first),
      ),
    )
    expect(results.map((result) => result.kind)).toEqual(
      Array.from({ length: 8 }, () => 'published'),
    )
    const tree = await store.listTree(workspace)
    expect(tree.map((entry) => entry.path).toSorted()).toEqual([
      'docs/0.md',
      'docs/1.md',
      'docs/2.md',
      'docs/3.md',
      'docs/4.md',
      'docs/5.md',
      'docs/6.md',
      'docs/7.md',
      'seed.md',
    ])
    for (const id of ids) expect(await store.read(workspace, id)).not.toBeNull()
  })

  it('uses the ref the caller names', async () => {
    const named = new GitContentStore({
      provider,
      now: NOW,
      random: JITTER,
      ref: 'refs/heads/content',
    })
    await named.publish({
      workspaceId: workspace,
      changes: [write(ONBOARDING, 'a.md', markdown(ONBOARDING, 'Onboarding'))],
      author: AUTHOR,
      base: null,
    })
    const objects = await provider.forWorkspace(workspace)
    expect(await objects.readRef('refs/heads/content')).not.toBeNull()
    expect(await objects.readRef('refs/heads/main')).toBeNull()
  })

  it('lets two stores that do not share a queue publish into one workspace', async () => {
    // Each store has its own in-process queue, so the only thing keeping them
    // apart is the compare-and-swap itself.
    const other = new GitContentStore({ provider, now: NOW, random: JITTER })
    const first = await publishDocument(ONBOARDING, 'seed.md', 'Seed', 'Seed.', null)
    const ids = Array.from({ length: 8 }, () => newDocument())
    const results = await Promise.all(
      ids.map((id, index) =>
        (index % 2 === 0 ? store : other).publish({
          workspaceId: workspace,
          changes: [write(id, `docs/${index}.md`, markdown(id, `Document ${index}`))],
          author: AUTHOR,
          base: first,
        }),
      ),
    )
    expect(results.map((result) => result.kind)).toEqual(
      Array.from({ length: 8 }, () => 'published'),
    )
    expect(await store.listTree(workspace)).toHaveLength(9)
  })
})

/** A store that loses the first `failures` compare-and-swap races. */
class ContendedStore implements ObjectStore {
  #remaining: number
  readonly #inner = new MemoryObjectStore()

  constructor(failures: number) {
    this.#remaining = failures
  }

  read(oid: string): Promise<Uint8Array | null> {
    return this.#inner.read(oid)
  }

  write(oid: string, bytes: Uint8Array): Promise<void> {
    return this.#inner.write(oid, bytes)
  }

  writeBatch(entries: readonly ObjectEntry[]): Promise<void> {
    return this.#inner.writeBatch(entries)
  }

  has(oid: string): Promise<boolean> {
    return this.#inner.has(oid)
  }

  readRef(name: string): Promise<string | null> {
    return this.#inner.readRef(name)
  }

  async casRef(name: string, expected: string | null, next: string): Promise<boolean> {
    if (this.#remaining > 0) {
      this.#remaining -= 1
      return false
    }
    return await this.#inner.casRef(name, expected, next)
  }
}

class ContendedProvider implements ObjectStoreProvider {
  readonly #store: ContendedStore

  constructor(failures: number) {
    this.#store = new ContendedStore(failures)
  }

  async forWorkspace(): Promise<ObjectStore> {
    return this.#store
  }
}

async function commitObject(objects: ObjectStore, revision: RevisionId): Promise<string> {
  return Buffer.from((await objects.read(revisionId(revision))) ?? []).toString('utf8')
}

async function commitMessage(objects: ObjectStore, revision: RevisionId): Promise<string> {
  const text = await commitObject(objects, revision)
  return text.slice(text.indexOf('\n\n') + 2)
}

/** The tree a commit object names, read straight out of its header. */
function decodeTreeOid(commit: string): string {
  return commit.slice(commit.indexOf('tree ') + 5, commit.indexOf('tree ') + 45)
}

describe('non-document files', () => {
  const SETTINGS = '.quill/organisation.yaml'

  async function putSettings(
    text: string,
    expected: string | null,
    extra: { summary?: string; changeNote?: string } = {},
  ): Promise<PutFileResult> {
    return await store.putFile({
      workspaceId: workspace,
      path: SETTINGS,
      text,
      expected,
      author: AUTHOR,
      ...extra,
    })
  }

  it('is null before the file exists', async () => {
    expect(await store.readFile(workspace, SETTINGS)).toBeNull()
  })

  it('writes a file into an unborn workspace and reads it back', async () => {
    const result = await putSettings('version: 1\n', null)
    expect(result.kind).toBe('published')
    expect(await store.readFile(workspace, SETTINGS)).toMatchObject({
      path: SETTINGS,
      text: 'version: 1\n',
    })
  })

  it('is null for a path the tree does not hold', async () => {
    await putSettings('version: 1\n', null)
    expect(await store.readFile(workspace, '.quill/nothing.yaml')).toBeNull()
  })

  it('is null for a workspace that has revisions but no such file', async () => {
    await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    expect(await store.readFile(workspace, SETTINGS)).toBeNull()
  })

  it('reads the file as it stood at an earlier revision', async () => {
    const first = writtenRevision(await putSettings('version: 1\n', null))
    await putSettings('version: 2\n', 'version: 1\n')
    expect(await store.readFile(workspace, SETTINGS, first)).toMatchObject({ text: 'version: 1\n' })
    expect(await store.readFile(workspace, SETTINGS)).toMatchObject({ text: 'version: 2\n' })
  })

  it('is null at a revision the store does not hold', async () => {
    await putSettings('version: 1\n', null)
    expect(await store.readFile(workspace, SETTINGS, revisionId('a'.repeat(40)))).toBeNull()
  })

  it('refuses a write whose expectation no longer holds, and says what it says now', async () => {
    await putSettings('version: 1\n', null)
    const result = await putSettings('version: 3\n', 'version: 2\n')
    expect(result).toEqual({
      kind: 'stale',
      current: { path: SETTINGS, text: 'version: 1\n', revision: await store.head(workspace) },
    })
  })

  it('refuses a create when the file is already there', async () => {
    await putSettings('version: 1\n', null)
    expect((await putSettings('version: 2\n', null)).kind).toBe('stale')
  })

  it('refuses a replacement when the file has gone', async () => {
    expect(await putSettings('version: 2\n', 'version: 1\n')).toEqual({
      kind: 'stale',
      current: null,
    })
  })

  it('leaves the documents beside it untouched', async () => {
    const first = await publishDocument(ONBOARDING, 'a.md', 'Onboarding', 'One.', null)
    await putSettings('version: 1\n', null)
    expect(await store.read(workspace, ONBOARDING)).toMatchObject({ path: 'a.md' })
    expect(await store.head(workspace)).not.toBe(first)
  })

  it('commits with a subject and the change note, and no document trailer', async () => {
    const revision = writtenRevision(
      await putSettings('version: 1\n', null, {
        summary: 'Set the organisation theme',
        changeNote: 'Brand refresh',
      }),
    )
    const message = await commitMessage(await provider.forWorkspace(workspace), revision)
    expect(message).toBe(`Set the organisation theme\n\n${CHANGE_NOTE_TRAILER}: Brand refresh\n`)
    expect(message).not.toContain(DOCUMENT_ID_TRAILER)
  })

  it('names the path when no summary is given, and adds no trailers at all', async () => {
    const revision = writtenRevision(await putSettings('version: 1\n', null))
    const message = await commitMessage(await provider.forWorkspace(workspace), revision)
    expect(message).toBe(`Update ${SETTINGS}\n`)
  })

  it('normalises the path it is given', async () => {
    await store.putFile({
      workspaceId: workspace,
      path: '.quill/café.yaml',
      text: 'version: 1\n',
      expected: null,
      author: AUTHOR,
    })
    expect(await store.readFile(workspace, '.quill/café.yaml')).not.toBeNull()
  })

  it('re-checks the expectation after losing a compare-and-swap race', async () => {
    const slept: number[] = []
    const retrying = new GitContentStore({
      provider: new ContendedProvider(2),
      now: NOW,
      sleep: async (ms) => void slept.push(ms),
      random: () => 0.5,
    })
    const result = await retrying.putFile({
      workspaceId: workspace,
      path: SETTINGS,
      text: 'version: 1\n',
      expected: null,
      author: AUTHOR,
    })
    expect(result.kind).toBe('published')
    expect(slept).toEqual([2, 3])
  })

  it('gives up after the attempt limit rather than spinning', async () => {
    const retrying = new GitContentStore({
      provider: new ContendedProvider(Number.POSITIVE_INFINITY),
      now: NOW,
      random: JITTER,
      sleep: async () => undefined,
      maxPublishAttempts: 3,
    })
    await expect(
      retrying.putFile({
        workspaceId: workspace,
        path: SETTINGS,
        text: 'version: 1\n',
        expected: null,
        author: AUTHOR,
      }),
    ).rejects.toThrow(/lost 3 compare-and-swap races/)
  })

  it('lets only one of two concurrent writers of the same expectation through', async () => {
    await putSettings('version: 1\n', null)
    const [first, second] = await Promise.all([
      putSettings('version: 2\n', 'version: 1\n'),
      putSettings('version: 3\n', 'version: 1\n'),
    ])
    expect([first.kind, second.kind].toSorted()).toEqual(['published', 'stale'])
  })
})
