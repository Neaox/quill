import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { DRAFT_CONTENT_VERSION } from '../ports/document-format.ts'
import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat } from '../test-support/fake-document-format.ts'
import { aShortId, createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createDocument } from './create-document.ts'
import { publishDocument, readDraftContent } from './publish-document.ts'
import type { PublishDependencies } from './publish-document.ts'
import { deleteDocument, DOCUMENT_AUDIT_EVENTS, updateDocument } from './update-document.ts'

/**
 * Review finding H5. `PATCH /api/documents/:id` used to hand `collectionId`
 * and `parentId` to the repository unchecked, and `parent_id` had no foreign
 * key — so one request could write a parent that did not exist, after which
 * every scope-chain walk for the document failed, *including the PATCH that
 * would have undone it*.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER_WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000102')
const ARCHITECTURE = 'architecture'
const RUNBOOKS = 'runbooks'

const PARENT = documentId('00000000-0000-4000-8000-000000000201')
const CHILD = documentId('00000000-0000-4000-8000-000000000202')
const GRANDCHILD = documentId('00000000-0000-4000-8000-000000000203')
const ELSEWHERE = documentId('00000000-0000-4000-8000-000000000204')
const MISSING = documentId('00000000-0000-4000-8000-0000000002ff')
const ACTOR = userId('00000000-0000-4000-8000-000000000001')
const SESSION = 'session-ada'

let uow: InMemoryUnitOfWork
/**
 * The publish dependencies, which are the update dependencies plus a content
 * store: a rename is proven by publishing after it, which is the whole of the
 * defect this suite exists for.
 */
let deps: PublishDependencies

async function addDocument(
  id: DocumentId,
  parentId: DocumentId | null,
  collectionId: string | null,
  workspace = WORKSPACE,
): Promise<void> {
  await uow.repos.documents.create({
    id,
    shortId: aShortId(),
    workspaceId: workspace,
    collectionId,
    parentId,
    slug: id,
    path: `${collectionId ?? 'loose'}/${id}.md`,
    title: id,
    status: 'draft',
    templateId: null,
    templateVersion: null,
    now: NOW,
  })
}

/** A draft for a document the tree fixture created, with the content a test needs. */
async function addDraft(
  id: DocumentId,
  frontMatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  await uow.repos.drafts.init({
    documentId: id,
    baseRevision: null,
    ast: { version: DRAFT_CONTENT_VERSION, frontMatter, ast: { body } },
    now: NOW,
  })
}

/** What the draft holds now, as the use cases read it. */
async function draftOf(
  id: DocumentId,
): Promise<{ frontMatter: Record<string, unknown>; body: string }> {
  const draft = await uow.repos.drafts.find(id)
  const content = readDraftContent(draft?.ast)
  if (content === null) throw new Error('no readable draft')
  return { frontMatter: content.frontMatter, body: String((content.ast as { body: string }).body) }
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  deps = {
    uow,
    contentStore: createFakeContentStore(),
    format: createFakeDocumentFormat(),
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
  }
  for (const [id, workspace] of [
    [ARCHITECTURE, WORKSPACE],
    [RUNBOOKS, WORKSPACE],
    ['design', OTHER_WORKSPACE],
  ] as const) {
    await uow.repos.collections.create({
      id,
      workspaceId: workspace,
      name: id,
      slug: id,
      now: NOW,
    })
  }
  await addDocument(PARENT, null, ARCHITECTURE)
  await addDocument(CHILD, PARENT, ARCHITECTURE)
  await addDocument(GRANDCHILD, CHILD, ARCHITECTURE)
  await addDocument(ELSEWHERE, null, RUNBOOKS)
})

describe('updateDocument', () => {
  it('renames without touching the document’s place', async () => {
    const result = await updateDocument(deps, {
      documentId: CHILD,
      sessionId: SESSION,
      patch: {
        title: 'Renamed',
        slug: 'renamed',
        path: 'architecture/renamed.md',
        status: 'published',
      },
    })
    if (result.kind !== 'updated') throw new Error(`unexpected result: ${result.kind}`)
    expect(result.document).toMatchObject({
      title: 'Renamed',
      slug: 'renamed',
      status: 'published',
      parentId: PARENT,
      collectionId: ARCHITECTURE,
    })
  })

  it('answers not-found for a document that does not exist', async () => {
    expect(
      await updateDocument(deps, {
        documentId: MISSING,
        sessionId: SESSION,
        patch: { title: 'x' },
      }),
    ).toEqual({
      kind: 'not-found',
    })
  })

  it('lifts a document to the root of its collection when the parent is null', async () => {
    const result = await updateDocument(deps, {
      documentId: CHILD,
      sessionId: SESSION,
      patch: { parentId: null },
    })
    if (result.kind !== 'updated') throw new Error(`unexpected result: ${result.kind}`)
    expect(result.document.parentId).toBeNull()
  })

  it('moves a document into another collection in the same workspace', async () => {
    const result = await updateDocument(deps, {
      documentId: ELSEWHERE,
      sessionId: SESSION,
      patch: { collectionId: ARCHITECTURE, parentId: PARENT },
    })
    if (result.kind !== 'updated') throw new Error(`unexpected result: ${result.kind}`)
    expect(result.document).toMatchObject({ collectionId: ARCHITECTURE, parentId: PARENT })
  })

  describe('refusing a destination that does not exist', () => {
    it('refuses a collection that is not there', async () => {
      expect(
        await updateDocument(deps, {
          documentId: CHILD,
          sessionId: SESSION,
          patch: { collectionId: 'nope' },
        }),
      ).toEqual({ kind: 'collection-not-found' })
    })

    /** Reported as missing, not forbidden: an id the caller cannot reach must not be confirmed. */
    it('refuses a collection in another workspace', async () => {
      expect(
        await updateDocument(deps, {
          documentId: CHILD,
          sessionId: SESSION,
          patch: { collectionId: 'design' },
        }),
      ).toEqual({ kind: 'collection-not-found' })
    })

    it('refuses a parent that is not there', async () => {
      expect(
        await updateDocument(deps, {
          documentId: CHILD,
          sessionId: SESSION,
          patch: { parentId: MISSING },
        }),
      ).toEqual({ kind: 'parent-not-found' })
    })

    it('refuses a parent in another workspace', async () => {
      const foreign = documentId('00000000-0000-4000-8000-000000000205')
      await addDocument(foreign, null, 'design', OTHER_WORKSPACE)
      expect(
        await updateDocument(deps, {
          documentId: CHILD,
          sessionId: SESSION,
          patch: { parentId: foreign },
        }),
      ).toEqual({ kind: 'parent-not-found' })
    })
  })

  it('refuses a parent that sits in a different collection from the destination', async () => {
    expect(
      await updateDocument(deps, {
        documentId: CHILD,
        sessionId: SESSION,
        patch: { parentId: ELSEWHERE },
      }),
    ).toEqual({ kind: 'parent-outside-collection' })
    // And the pair moves together happily when both are named.
    expect(
      (
        await updateDocument(deps, {
          documentId: CHILD,
          sessionId: SESSION,
          patch: { collectionId: RUNBOOKS, parentId: ELSEWHERE },
        })
      ).kind,
    ).toBe('updated')
  })

  describe('refusing a cycle', () => {
    it('refuses a document as its own parent', async () => {
      expect(
        await updateDocument(deps, {
          documentId: CHILD,
          sessionId: SESSION,
          patch: { parentId: CHILD },
        }),
      ).toEqual({
        kind: 'cycle',
      })
    })

    it('refuses a parent that is one of the document’s own descendants', async () => {
      // PARENT → CHILD → GRANDCHILD; making GRANDCHILD the parent of PARENT
      // would close the loop and make every walk through it fail.
      expect(
        await updateDocument(deps, {
          documentId: PARENT,
          sessionId: SESSION,
          patch: { parentId: GRANDCHILD },
        }),
      ).toEqual({ kind: 'cycle' })
    })
  })
})

/**
 * The defect use case 8 was open on: `PATCH /api/documents/:id` set the row's
 * title, publishing re-derived the title from the draft's front matter, and
 * the rename was silently undone. The title lives in the document; the column
 * is an index of it (ADR-034), so a rename writes the document.
 */
describe('renaming, which is a write to the document', () => {
  async function aDocument(title: string): Promise<DocumentId> {
    const created = await createDocument(deps, {
      workspaceId: WORKSPACE,
      collectionId: ARCHITECTURE,
      parentId: null,
      title,
      createdBy: ACTOR,
    })
    if (created.kind !== 'created') throw new Error(created.kind)
    return created.document.id
  }

  it('keeps the new title through a publish', async () => {
    const id = await aDocument('Quarterly plan')

    const renamed = await updateDocument(deps, {
      documentId: id,
      sessionId: SESSION,
      patch: { title: 'Quarterly plan 2026' },
    })
    expect(renamed.kind === 'updated' && renamed.document.title).toBe('Quarterly plan 2026')

    // The draft carries it, which is the whole of the fix: front matter and
    // the heading that names the document both say the new name.
    expect(await draftOf(id)).toEqual({
      frontMatter: { id, title: 'Quarterly plan 2026' },
      body: '# Quarterly plan 2026',
    })

    const published = await publishDocument(deps, {
      documentId: id,
      base: null,
      author: { userId: ACTOR, name: 'Ada', email: 'ada@example.com' },
      sessionId: SESSION,
    })
    expect(published.kind === 'published' && published.document.title).toBe('Quarterly plan 2026')
  })

  it('bumps the draft version, so an open editor re-reads before its next write', async () => {
    const id = await aDocument('Quarterly plan')
    const before = await uow.repos.drafts.find(id)

    await updateDocument(deps, {
      documentId: id,
      sessionId: SESSION,
      patch: { title: 'Quarterly plan 2026' },
    })

    const after = await uow.repos.drafts.find(id)
    expect(after?.draftVersion).toBe((before?.draftVersion ?? 0) + 1)
    expect(after?.baseRevision).toBe(before?.baseRevision ?? null)
  })

  it('gives a document that declared no title one, and renames the heading that named it', async () => {
    await addDraft(CHILD, { id: CHILD, tags: ['imported'] }, '# Imported page\n\nBody.')

    await updateDocument(deps, {
      documentId: CHILD,
      sessionId: SESSION,
      patch: { title: 'Adopted page' },
    })

    // Key order is the document's: what was there stays where it was, and the
    // title the document never declared is appended rather than inserted.
    expect(await draftOf(CHILD)).toEqual({
      frontMatter: { id: CHILD, tags: ['imported'], title: 'Adopted page' },
      body: '# Adopted page\n\nBody.',
    })
  })

  it('leaves a first heading that is not the document’s title alone', async () => {
    await addDraft(CHILD, { id: CHILD, title: 'Runbook' }, '## Summary\n\nWhat to do at 3am.')

    await updateDocument(deps, {
      documentId: CHILD,
      sessionId: SESSION,
      patch: { title: 'Incident runbook' },
    })

    expect(await draftOf(CHILD)).toEqual({
      frontMatter: { id: CHILD, title: 'Incident runbook' },
      body: '## Summary\n\nWhat to do at 3am.',
    })
  })

  it('refuses the rename while another session is editing the document', async () => {
    await addDraft(CHILD, { id: CHILD, title: 'Runbook' }, '# Runbook')
    await uow.repos.locks.acquire({
      documentId: CHILD,
      userId: ACTOR,
      sessionId: 'session-grace',
      now: NOW,
    })

    const refused = await updateDocument(deps, {
      documentId: CHILD,
      sessionId: SESSION,
      patch: { title: 'Incident runbook' },
    })
    expect(refused.kind === 'lock-lost' && refused.holder.holderSessionId).toBe('session-grace')

    // Nothing moved: neither the row nor the draft.
    expect((await uow.repos.documents.findById(CHILD))?.title).toBe(CHILD)
    expect((await draftOf(CHILD)).frontMatter['title']).toBe('Runbook')

    // The session that holds the lock renames freely.
    const held = await updateDocument(deps, {
      documentId: CHILD,
      sessionId: 'session-grace',
      patch: { title: 'Incident runbook' },
    })
    expect(held.kind).toBe('updated')
  })

  it('renames the row of a document with no draft, and of one it cannot read', async () => {
    const noDraft = await updateDocument(deps, {
      documentId: ELSEWHERE,
      sessionId: SESSION,
      patch: { title: 'Still renamed' },
    })
    expect(noDraft.kind === 'updated' && noDraft.document.title).toBe('Still renamed')

    // A draft from a newer release (ADR-033) is not a reason to refuse a
    // rename: the column is an index, and it is still the caller's to set.
    await uow.repos.drafts.init({
      documentId: CHILD,
      baseRevision: null,
      ast: { version: DRAFT_CONTENT_VERSION + 1, frontMatter: {}, ast: {} },
      now: NOW,
    })
    const unreadable = await updateDocument(deps, {
      documentId: CHILD,
      sessionId: SESSION,
      patch: { title: 'Renamed anyway' },
    })
    expect(unreadable.kind === 'updated' && unreadable.document.title).toBe('Renamed anyway')
  })

  it('announces a rename once, and says nothing when the title has not changed', async () => {
    await addDraft(CHILD, { id: CHILD, title: CHILD }, `# ${CHILD}`)

    await updateDocument(deps, {
      documentId: CHILD,
      sessionId: SESSION,
      patch: { title: CHILD },
    })
    expect(uow.events.filter((event) => event.type === 'DocumentRenamed')).toEqual([])

    await updateDocument(deps, {
      documentId: CHILD,
      sessionId: SESSION,
      patch: { title: 'Renamed' },
    })
    expect(uow.events.filter((event) => event.type === 'DocumentRenamed')).toMatchObject([
      { payload: { documentId: CHILD, workspaceId: WORKSPACE, from: CHILD, to: 'Renamed' } },
    ])
  })
})

describe('deleteDocument', () => {
  it('deletes it and records how many children were lifted to the root', async () => {
    const audited: unknown[] = []
    const withAudit = {
      ...deps,
      uow: {
        ...uow,
        repos: {
          ...uow.repos,
          audit: {
            async write(input: unknown): Promise<void> {
              audited.push(input)
            },
          },
        },
      },
    }

    expect(await deleteDocument(withAudit, { documentId: PARENT, deletedBy: ACTOR })).toEqual({
      kind: 'deleted',
    })
    expect(await uow.repos.documents.findById(PARENT)).toBeNull()
    expect(audited[0]).toMatchObject({
      type: DOCUMENT_AUDIT_EVENTS.deleted,
      targetType: 'document',
      targetId: PARENT,
      metadata: { childrenLifted: 1 },
    })
  })

  it('answers not-found for a document that does not exist', async () => {
    expect(await deleteDocument(deps, { documentId: MISSING, deletedBy: ACTOR })).toEqual({
      kind: 'not-found',
    })
  })
})
