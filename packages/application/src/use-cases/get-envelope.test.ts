import { beforeEach, describe, expect, it } from 'vitest'
import { capabilitiesForRole, documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { LOCK_TTL_MS } from '../ports/persistence.ts'
import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import type { FakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat, serialise } from '../test-support/fake-document-format.ts'
import { createFakeClock, createFakeHasher, createFakeIdGenerator } from '../test-support/fakes.ts'
import type { FakeClock } from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createDocument } from './create-document.ts'
import { getEnvelope, reviewOf } from './get-envelope.ts'
import type { EnvelopeDependencies } from './get-envelope.ts'
import { publishDocument, readDraftContent } from './publish-document.ts'

const NOW = new Date('2026-03-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const AUTHOR = userId('00000000-0000-4000-8000-000000000001')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')

const author = { userId: AUTHOR, name: 'Ada', email: 'ada@example.com' }
const SESSION = 'session-ada'
const editor = capabilitiesForRole('editor')

let uow: InMemoryUnitOfWork
let contentStore: FakeContentStore
let clock: FakeClock
let deps: EnvelopeDependencies

async function draft(
  title: string,
  body: string,
  frontMatter: Record<string, unknown> = {},
): Promise<DocumentId> {
  const created = await createDocument(deps, {
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    title,
    createdBy: AUTHOR,
  })
  if (created.kind !== 'created') throw new Error(created.kind)
  const content = readDraftContent(created.draft.ast)
  await uow.repos.drafts.init({
    documentId: created.document.id,
    baseRevision: null,
    ast: {
      version: 1,
      frontMatter: { ...content?.frontMatter, ...frontMatter },
      ast: { body },
    },
    now: NOW,
  })
  return created.document.id
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
    hasher: createFakeHasher(),
  }
  await uow.repos.users.create({
    id: AUTHOR,
    email: 'ada@example.com',
    displayName: 'Ada',
    now: NOW,
  })
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

describe('getEnvelope', () => {
  it('reports a lock nobody has heartbeaten within its lifetime as no lock at all', async () => {
    const id = await draft('Overview', '# Overview')
    await uow.repos.locks.acquire({
      documentId: id,
      userId: AUTHOR,
      sessionId: 'session-ada',
      now: NOW,
    })

    clock.advance(LOCK_TTL_MS)
    const held = await getEnvelope(deps, { documentId: id, capabilities: editor })
    expect(held.kind === 'envelope' && held.envelope.lock?.holderUserId).toBe(AUTHOR)

    // A strict less-than, so the tie above is still held and one more
    // millisecond is not (ADR-021).
    clock.advance(1)
    const lapsed = await getEnvelope(deps, { documentId: id, capabilities: editor })
    expect(lapsed.kind === 'envelope' && lapsed.envelope.lock).toBeNull()
  })

  it('reports the permissions the request already resolved', async () => {
    const id = await draft('Overview', '# Overview')
    const result = await getEnvelope(deps, { documentId: id, capabilities: editor })
    expect(result.kind === 'envelope' && result.envelope.permissions).toEqual({
      view: true,
      comment: true,
      edit: true,
      manage: false,
    })
  })

  it('has no published state, no review, and no health before the first publish', async () => {
    const id = await draft('Overview', '# Overview')
    const result = await getEnvelope(deps, { documentId: id, capabilities: editor })
    expect(result.kind === 'envelope' && result.envelope).toMatchObject({
      lock: null,
      lastPublished: null,
      review: null,
      health: [],
    })
  })

  it('names the lock holder and the last publish', async () => {
    const id = await draft('Overview', '# Overview', { owners: ['ada@example.com'] })
    const published = await publishDocument(deps, {
      documentId: id,
      base: null,
      author,
      sessionId: SESSION,
    })
    await uow.repos.locks.acquire({
      documentId: id,
      userId: AUTHOR,
      sessionId: 'session-1',
      now: NOW,
    })

    const result = await getEnvelope(deps, { documentId: id, capabilities: editor })
    expect(result.kind).toBe('envelope')
    if (result.kind !== 'envelope') return
    expect(result.envelope.lock).toMatchObject({ holderUserId: AUTHOR, holderName: 'Ada' })
    expect(result.envelope.lastPublished).toMatchObject({
      revision: published.kind === 'published' ? published.revision : '',
      author: 'Ada',
      at: NOW,
    })
    expect(result.envelope.health).toEqual([])
  })

  it('falls back to an unknown holder when the lock names a user that is gone', async () => {
    const id = await draft('Overview', '# Overview')
    await uow.repos.locks.acquire({
      documentId: id,
      userId: MISSING as unknown as typeof AUTHOR,
      sessionId: 'session-1',
      now: NOW,
    })
    const result = await getEnvelope(deps, { documentId: id, capabilities: editor })
    expect(result.kind === 'envelope' && result.envelope.lock?.holderName).toBe('Unknown')
  })

  it('reports every health signal a published document earns', async () => {
    // One link that resolves and one that does not: only the second is a
    // signal, and a document that exists is never mentioned.
    const runbook = await draft('Runbook', '# Runbook')
    const id = await draft(
      'Decision record',
      `# Context\n\nSome context.\n\n# Decision\n\n# Links\n\n[here](/d/${runbook}) [gone](/d/${MISSING})`,
      { requiredSections: ['Decision'], review: { interval: '30d' } },
    )
    await publishDocument(deps, { documentId: id, base: null, author, sessionId: SESSION })
    clock.advance(90 * 24 * 60 * 60 * 1000)

    const result = await getEnvelope(deps, { documentId: id, capabilities: editor })
    expect(result.kind).toBe('envelope')
    if (result.kind !== 'envelope') return
    expect(result.envelope.review).toEqual({
      dueAt: new Date('2026-03-31T00:00:00.000Z'),
      overdue: true,
    })
    expect(result.envelope.health).toEqual([
      { kind: 'no-owner' },
      { kind: 'review-overdue' },
      { kind: 'required-section-empty', detail: 'Decision' },
      { kind: 'broken-link', detail: `/d/${MISSING}` },
    ])
  })

  it('reports a published document that has no index row yet', async () => {
    const id = await draft('Overview', '# Overview')
    const document = await uow.repos.documents.findById(id)
    await contentStore.publish({
      workspaceId: WORKSPACE,
      base: null,
      author: { name: 'Ada', email: 'ada@example.com' },
      changes: [
        {
          kind: 'write',
          documentId: id,
          path: document?.path ?? '',
          markdown: serialise({ id, owners: ['ada@example.com'] }, '# Overview'),
        },
      ],
    })

    const result = await getEnvelope(deps, { documentId: id, capabilities: editor })
    expect(result.kind === 'envelope' && result.envelope.lastPublished).toBeNull()
    expect(result.kind === 'envelope' && result.envelope.review).toBeNull()
  })

  it('counts a link that still resolves as healthy', async () => {
    const target = await draft('Runbook', '# Runbook')
    await publishDocument(deps, { documentId: target, base: null, author, sessionId: SESSION })
    const id = await draft('Overview', `# Overview\n\n[runbook](/d/${target})`, {
      owners: ['ada@example.com'],
    })
    await publishDocument(deps, {
      documentId: id,
      base: await contentStore.head(WORKSPACE),
      author,
      sessionId: SESSION,
    })

    const result = await getEnvelope(deps, { documentId: id, capabilities: editor })
    expect(result.kind === 'envelope' && result.envelope.health).toEqual([])
  })

  it('reports a document it cannot find', async () => {
    expect(await getEnvelope(deps, { documentId: MISSING, capabilities: editor })).toEqual({
      kind: 'not-found',
      documentId: MISSING,
    })
  })
})

describe('reviewOf', () => {
  it('reads a review date whether the parser gave a string or a Date', () => {
    const interval = { review: { interval: '1m' } }
    const from = new Date('2026-01-01T00:00:00.000Z')
    expect(
      reviewOf({ review: { ...interval.review, lastReviewed: from } }, null, NOW)?.dueAt,
    ).toEqual(
      reviewOf({ review: { ...interval.review, lastReviewed: from.toISOString() } }, null, NOW)
        ?.dueAt,
    )
    // A date the YAML parser made of something that is not one.
    expect(
      reviewOf(
        { review: { ...interval.review, lastReviewed: new Date('the third of never') } },
        null,
        NOW,
      ),
    ).toBeNull()
  })

  const lastPublished = new Date('2026-01-01T00:00:00.000Z')

  it('counts the interval from the last review when there is one', () => {
    expect(
      reviewOf({ review: { interval: '1m', lastReviewed: '2026-02-01' } }, lastPublished, NOW),
    ).toEqual({ dueAt: new Date('2026-03-03T00:00:00.000Z'), overdue: false })
  })

  it('counts weeks and years as well as days', () => {
    expect(reviewOf({ review: { interval: '2w' } }, lastPublished, NOW)?.dueAt).toEqual(
      new Date('2026-01-15T00:00:00.000Z'),
    )
    expect(reviewOf({ review: { interval: '1y' } }, lastPublished, NOW)?.dueAt).toEqual(
      new Date('2027-01-01T00:00:00.000Z'),
    )
  })

  it('reports nothing when there is nothing to count from or the interval makes no sense', () => {
    expect(reviewOf({}, lastPublished, NOW)).toBeNull()
    expect(reviewOf({ review: 'soon' }, lastPublished, NOW)).toBeNull()
    expect(reviewOf({ review: { interval: 42 } }, lastPublished, NOW)).toBeNull()
    expect(reviewOf({ review: { interval: 'whenever' } }, lastPublished, NOW)).toBeNull()
    expect(reviewOf({ review: { interval: '30x' } }, lastPublished, NOW)).toBeNull()
    expect(reviewOf({ review: { interval: '30d' } }, null, NOW)).toBeNull()
    expect(reviewOf({ review: { interval: '30d', lastReviewed: 'never' } }, null, NOW)).toBeNull()
  })
})
