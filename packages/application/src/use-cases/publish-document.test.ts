import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId, RevisionId } from '@quill/domain'

import type { ContentStore } from '../ports/content-store.ts'
import { LOCK_TTL_MS } from '../ports/persistence.ts'
import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import type { FakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat } from '../test-support/fake-document-format.ts'
import { aShortId, createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { DRAFT_CONTENT_VERSION } from '../ports/document-format.ts'
import { createDocument } from './create-document.ts'
import { publishDocument, readDraftContent, recordPublish } from './publish-document.ts'
import type { PublishDependencies } from './publish-document.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const AUTHOR = userId('00000000-0000-4000-8000-000000000001')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')

const author = { userId: AUTHOR, name: 'Ada', email: 'ada@example.com' }
const SESSION = 'session-ada'

let uow: InMemoryUnitOfWork
let contentStore: FakeContentStore
let clock: FakeClock
let deps: PublishDependencies

/**
 * A content store that lets somebody else act in the instant before a publish
 * lands — the interleaving a second editor really is.
 */
function interleaved(act: () => Promise<unknown>): ContentStore {
  let acted = false
  return {
    ...contentStore,
    async publish(request) {
      if (!acted) {
        acted = true
        await act()
      }
      return contentStore.publish(request)
    },
  }
}

/** Somebody else publishes this document, from the same base. */
async function publishBehindMyBack(id: DocumentId, base: RevisionId): Promise<void> {
  const document = await uow.repos.documents.findById(id)
  await contentStore.publish({
    workspaceId: WORKSPACE,
    changes: [
      {
        kind: 'write',
        documentId: id,
        path: document?.path ?? '',
        markdown: '# Second, theirs',
      },
    ],
    author: { name: 'Grace', email: 'grace@example.com' },
    base,
  })
}

async function newDocument(title = 'Authentication architecture'): Promise<DocumentId> {
  const created = await createDocument(deps, {
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    title,
    createdBy: AUTHOR,
  })
  if (created.kind !== 'created') throw new Error(created.kind)
  return created.document.id
}

async function writeDraft(id: DocumentId, body: string, title?: string): Promise<void> {
  const draft = await uow.repos.drafts.find(id)
  const content = readDraftContent(draft?.ast)
  if (content === null) throw new Error('no draft')
  await uow.repos.drafts.init({
    documentId: id,
    baseRevision: draft?.baseRevision ?? null,
    ast: {
      ...content,
      frontMatter: { ...content.frontMatter, ...(title === undefined ? {} : { title }) },
      ast: { body },
    },
    now: NOW,
  })
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  contentStore = createFakeContentStore()
  clock = createFakeClock(NOW)
  deps = {
    uow,
    contentStore,
    format: createFakeDocumentFormat(),
    clock,
    ids: createFakeIdGenerator(),
  }
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'architecture',
    workspaceId: WORKSPACE,
    name: 'Architecture',
    slug: 'architecture',
    now: NOW,
  })
})

describe('publishDocument', () => {
  it('publishes a draft and records everything the revision leaves behind', async () => {
    const id = await newDocument()
    await writeDraft(id, '# Authentication architecture\n\nIt signs tokens.')

    const result = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    expect(result.kind).toBe('published')
    if (result.kind !== 'published') return

    expect(result.document.headRevision).toBe(result.revision)
    expect(result.document.status).toBe('published')

    const [revision] = await uow.repos.revisions.listForDocument(id, { limit: 10 })
    expect(revision).toMatchObject({
      revision: result.revision,
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      summary: 'Authentication architecture',
      changeNote: null,
    })
    expect((await uow.repos.drafts.find(id))?.baseRevision).toBe(result.revision)
    expect(uow.events.map((event) => event.type)).toEqual(['DocumentCreated', 'DocumentPublished'])
    expect(await contentStore.read(WORKSPACE, id)).toMatchObject({
      path: 'architecture/authentication-architecture.md',
    })
  })

  it('carries the change note onto the revision', async () => {
    const id = await newDocument()
    await writeDraft(id, '# Authentication architecture')
    const result = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
      changeNote: 'Clarify the token lifetime',
    })
    expect(result.kind).toBe('published')
    const [revision] = await uow.repos.revisions.listForDocument(id, { limit: 1 })
    expect(revision?.changeNote).toBe('Clarify the token lifetime')
    expect(contentStore.requests.at(-1)?.changeNote).toBe('Clarify the token lifetime')
  })

  it('states what is incomplete and publishes anyway', async () => {
    const id = await newDocument()
    const draft = await uow.repos.drafts.find(id)
    const content = readDraftContent(draft?.ast)
    await uow.repos.drafts.init({
      documentId: id,
      baseRevision: null,
      ast: {
        version: DRAFT_CONTENT_VERSION,
        frontMatter: { ...content?.frontMatter, requiredSections: ['Decision'] },
        ast: { body: '# Decision\n\n::placeholder what did we decide?' },
      },
      now: NOW,
    })

    const result = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    expect(result.kind).toBe('published')
    if (result.kind !== 'published') return
    expect(result.warnings).toEqual([
      { code: 'placeholder-remains', detail: ' what did we decide?' },
    ])
    expect(result.incompleteRequiredSections).toEqual(['Decision'])
    expect(result.frontMatterIssues).toEqual([])
  })

  it('reports front matter that does not match the schema without refusing the publish', async () => {
    const id = await newDocument()
    const draft = await uow.repos.drafts.find(id)
    await uow.repos.drafts.init({
      documentId: id,
      baseRevision: null,
      ast: {
        version: DRAFT_CONTENT_VERSION,
        frontMatter: { title: 42 },
        ast: { body: '# Fallback title from the body' },
      },
      now: NOW,
    })
    expect(draft).not.toBeNull()

    const result = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    expect(result.kind).toBe('published')
    if (result.kind !== 'published') return
    expect(result.frontMatterIssues).toEqual([{ path: 'title', message: 'must be a string' }])
    expect(result.document.title).toBe('Fallback title from the body')
  })

  it('emits DocumentRenamed when a publish changes the title', async () => {
    const id = await newDocument()
    await writeDraft(id, '# Authentication architecture')
    await publishDocument(deps, { documentId: id, base: null, author, sessionId: SESSION })

    await writeDraft(id, '# Authentication', 'Authentication')
    const republished = await publishDocument(deps, {
      documentId: id,
      base: await contentStore.head(WORKSPACE),
      author,
      sessionId: SESSION,
    })
    expect(republished.kind === 'published' && republished.document.title).toBe('Authentication')
    expect(uow.events.map((event) => event.type)).toEqual([
      'DocumentCreated',
      'DocumentPublished',
      'DocumentPublished',
      'DocumentRenamed',
    ])
    expect(uow.events.at(-1)?.payload).toMatchObject({
      from: 'Authentication architecture',
      to: 'Authentication',
    })
  })

  it('refuses a base the draft does not record, rather than merging against it', async () => {
    const id = await newDocument()
    await writeDraft(id, '# First')
    const first = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    if (first.kind !== 'published') throw new Error(first.kind)

    // The draft is based on the revision the publish created. A caller working
    // from a view older than that is told to re-read, not merged against a
    // base the author never edited from.
    await writeDraft(id, '# Second')
    expect(
      await publishDocument(deps, { documentId: id, base: null, author, sessionId: SESSION }),
    ).toEqual({ kind: 'stale-base', base: first.revision })
    expect(await uow.repos.revisions.listForDocument(id, { limit: 10 })).toHaveLength(1)

    const published = await publishDocument(deps, {
      documentId: id,
      base: first.revision,
      author,
      sessionId: SESSION,
    })
    expect(published.kind).toBe('published')
  })

  it("merges against the draft's own base when somebody publishes in between", async () => {
    const id = await newDocument()
    await writeDraft(id, '# First')
    const first = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    if (first.kind !== 'published') throw new Error(first.kind)
    await writeDraft(id, '# Second, mine')

    const stale = await publishDocument(
      { ...deps, contentStore: interleaved(() => publishBehindMyBack(id, first.revision)) },
      { documentId: id, base: first.revision, author, sessionId: SESSION },
    )
    expect(stale.kind).toBe('merge-required')
    if (stale.kind !== 'merge-required') return
    expect(stale.conflicts).toHaveLength(1)
    expect(stale.current).not.toBe(first.revision)
    expect(await uow.repos.revisions.listForDocument(id, { limit: 10 })).toHaveLength(1)
  })

  it('refuses to publish over a lock somebody else holds, and allows an expired one', async () => {
    const id = await newDocument()
    await writeDraft(id, '# Overview')
    await uow.repos.locks.acquire({
      documentId: id,
      userId: AUTHOR,
      sessionId: 'session-grace',
      now: NOW,
    })

    const taken = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    expect(taken.kind === 'lock-lost' && taken.holder.holderSessionId).toBe('session-grace')
    expect(contentStore.requests).toHaveLength(0)

    // The holder publishes from the session that holds it, and once that lock
    // has lapsed anybody may: a released or expired lock blocks nothing.
    const held = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: 'session-grace',
    })
    expect(held.kind).toBe('published')

    await writeDraft(id, '# Overview, again')
    clock.advance(LOCK_TTL_MS + 1)
    const afterExpiry = await publishDocument(deps, {
      documentId: id,
      base: held.kind === 'published' ? held.revision : null,
      author,
      sessionId: SESSION,
    })
    expect(afterExpiry.kind).toBe('published')
  })

  it('refuses when the document is taken over while the publish is in flight', async () => {
    const id = await newDocument()
    await writeDraft(id, '# Overview')

    const result = await publishDocument(
      {
        ...deps,
        contentStore: interleaved(async () => {
          await uow.repos.locks.adminTakeover({
            documentId: id,
            userId: AUTHOR,
            sessionId: 'session-grace',
            now: NOW,
          })
        }),
      },
      { documentId: id, base: null, author, sessionId: SESSION },
    )

    // The content store has the bytes; Postgres records nothing, so the
    // document's head, its history, and its events all still describe the
    // revision before this one.
    expect(result.kind === 'lock-lost' && result.holder.holderSessionId).toBe('session-grace')
    expect(await uow.repos.revisions.listForDocument(id, { limit: 10 })).toEqual([])
    expect((await uow.repos.documents.findById(id))?.headRevision).toBeNull()
  })

  it('reports a document, a draft, or a draft version it cannot read', async () => {
    expect(
      await publishDocument(deps, { documentId: MISSING, base: null, author, sessionId: SESSION }),
    ).toEqual({
      kind: 'not-found',
      documentId: MISSING,
    })

    const id = await newDocument()
    const draft = await uow.repos.drafts.find(id)
    expect(draft).not.toBeNull()
    await uow.repos.drafts.init({
      documentId: id,
      baseRevision: null,
      ast: { version: 99 },
      now: NOW,
    })
    expect(
      await publishDocument(deps, { documentId: id, base: null, author, sessionId: SESSION }),
    ).toEqual({
      kind: 'draft-unreadable',
      documentId: id,
    })

    await uow.repos.documents.create({
      id: MISSING,
      shortId: aShortId(),
      workspaceId: WORKSPACE,
      collectionId: 'architecture',
      parentId: null,
      slug: 'no-draft',
      path: 'architecture/no-draft.md',
      title: 'No draft',
      status: 'draft',
      templateId: null,
      templateVersion: null,
      now: NOW,
    })
    expect(
      await publishDocument(deps, { documentId: MISSING, base: null, author, sessionId: SESSION }),
    ).toEqual({
      kind: 'no-draft',
      documentId: MISSING,
    })
  })
})

describe('recordPublish', () => {
  it('records one history entry and one event however often it is repeated', async () => {
    const id = await newDocument()
    await writeDraft(id, '# Overview')
    const published = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    if (published.kind !== 'published') throw new Error(published.kind)
    const document = await uow.repos.documents.findById(id)
    if (document === null) throw new Error('no document')

    // A publish whose content reached the store and whose record did not is
    // retried; the retry must not write a second history entry or a second
    // event for the same revision.
    const again = await recordPublish(deps, {
      document,
      revision: published.revision,
      title: document.title,
      summary: document.title,
      author,
      sessionId: SESSION,
      changeNote: null,
    })
    expect(again.ok && again.document.headRevision).toBe(published.revision)
    expect(await uow.repos.revisions.listForDocument(id, { limit: 10 })).toHaveLength(1)
    expect(uow.events.filter((event) => event.type === 'DocumentPublished')).toHaveLength(1)
  })
})

describe('publish titles', () => {
  it('keeps the document row title when neither front matter nor body names one', async () => {
    const id = await newDocument('Authentication architecture')
    const draft = await uow.repos.drafts.find(id)
    expect(draft).not.toBeNull()
    await uow.repos.drafts.init({
      documentId: id,
      baseRevision: null,
      ast: { version: DRAFT_CONTENT_VERSION, frontMatter: {}, ast: { body: 'Just prose.' } },
      now: NOW,
    })

    const result = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    expect(result.kind === 'published' && result.document.title).toBe('Authentication architecture')
    expect(uow.events.filter((event) => event.type === 'DocumentRenamed')).toEqual([])
  })
})

describe('readDraftContent', () => {
  it('accepts the version it writes and refuses everything else', () => {
    const content = { version: DRAFT_CONTENT_VERSION, frontMatter: {}, ast: { body: '' } }
    expect(readDraftContent(content)).toEqual(content)
    expect(readDraftContent(null)).toBeNull()
    expect(readDraftContent('draft')).toBeNull()
    expect(readDraftContent({ version: 2, frontMatter: {} })).toBeNull()
    expect(readDraftContent({ version: DRAFT_CONTENT_VERSION, frontMatter: null })).toBeNull()
  })
})

describe('publish revision identifiers', () => {
  it('gives every publish a distinct revision', async () => {
    const id = await newDocument()
    await writeDraft(id, '# One')
    const first = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    await writeDraft(id, '# Two')
    const second = await publishDocument(deps, {
      documentId: id,
      base: (first as { revision: RevisionId }).revision,
      author,
      sessionId: SESSION,
    })
    expect((first as { revision: RevisionId }).revision).not.toBe(
      (second as { revision: RevisionId }).revision,
    )
  })
})

describe('publishDocument: links', () => {
  it('rewrites a link pasted out of the address bar into the canonical form', async () => {
    const target = await newDocument('Runbook')
    const targetRow = await uow.repos.documents.findById(target)
    const source = await newDocument('Overview')
    await writeDraft(
      source,
      `See [the runbook](/w/engineering/d/runbook-${targetRow?.shortId ?? ''}).`,
    )

    const published = await publishDocument(deps, {
      documentId: source,
      base: null,
      author,
      sessionId: SESSION,
    })
    expect(published.kind).toBe('published')

    const stored = await contentStore.read(WORKSPACE, source)
    expect(stored?.markdown).toContain(`/d/${target}`)
    expect(stored?.markdown).not.toContain('/w/engineering/')
  })

  it('leaves a link whose key names nothing exactly as the author wrote it', async () => {
    const source = await newDocument('Overview')
    const dangling = `/w/engineering/d/gone-${aShortId(99)}`
    await writeDraft(source, `See [the runbook](${dangling}).`)

    await publishDocument(deps, { documentId: source, base: null, author, sessionId: SESSION })
    const stored = await contentStore.read(WORKSPACE, source)
    expect(stored?.markdown).toContain(dangling)
  })
})
