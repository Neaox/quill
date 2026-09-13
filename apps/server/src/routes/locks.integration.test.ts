import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createGrant } from '@quill/application'
import type { DocumentId } from '@quill/domain'

import { createServerHarness, HARNESS_NOW } from '../test-support/harness.ts'
import type { ServerHarness } from '../test-support/harness.ts'
import { seedTenancy } from '../test-support/tenancy-fixture.ts'
import type { TenancyFixture } from '../test-support/tenancy-fixture.ts'

/**
 * The ADR-021 locking contract, end to end: acquire, heartbeat, release,
 * takeover, and the exact status codes a client dispatches on.
 */

let harness: ServerHarness
let tenancy: TenancyFixture
let admin: Record<string, string>
let editor: Record<string, string>
let viewer: Record<string, string>

beforeAll(async () => {
  harness = await createServerHarness()
  tenancy = await seedTenancy(harness)
  admin = await harness.cookiesFor(tenancy.admin)
  editor = await harness.cookiesFor(tenancy.editor)
  viewer = await harness.cookiesFor(tenancy.viewer)
}, 30_000)

afterAll(async () => {
  await harness.close()
})

beforeEach(async () => {
  harness.clock.set(HARNESS_NOW)
  await harness.database.pool.query('DELETE FROM document_locks')
})

async function newDocument(title: string): Promise<DocumentId> {
  const response = await harness.app.inject({
    method: 'POST',
    url: `/api/workspaces/${tenancy.workspaceId}/documents`,
    cookies: editor,
    payload: { collectionId: tenancy.collectionId, title },
  })
  expect(response.statusCode).toBe(201)
  return response.json().document.id as DocumentId
}

async function acquire(id: DocumentId, cookies: Record<string, string>) {
  return await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/lock/acquire`,
    cookies,
  })
}

async function heartbeat(id: DocumentId, cookies: Record<string, string>) {
  return await harness.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/lock/heartbeat`,
    cookies,
  })
}

async function release(id: DocumentId, cookies: Record<string, string>) {
  return await harness.app.inject({ method: 'DELETE', url: `/api/documents/${id}/lock`, cookies })
}

async function writeDraft(
  id: DocumentId,
  cookies: Record<string, string>,
  payload: Record<string, unknown>,
) {
  return await harness.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    cookies,
    payload,
  })
}

describe('lock and draft routes', () => {
  it('runs the full acquire, write, heartbeat, release cycle', async () => {
    const id = await newDocument('Lock cycle')

    expect((await acquire(id, editor)).statusCode).toBe(200)
    const write = await writeDraft(id, editor, {
      ast: { version: 1, frontMatter: {}, ast: { type: 'root', children: [] } },
      expectedVersion: 0,
    })
    expect(write.statusCode).toBe(200)
    expect(write.json()).toMatchObject({ draftVersion: 1 })

    const read = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${id}/draft`,
      cookies: editor,
    })
    expect(read.statusCode).toBe(200)
    expect(read.json()).toMatchObject({ documentId: id, draftVersion: 1 })

    expect((await heartbeat(id, editor)).statusCode).toBe(200)
    expect((await release(id, editor)).statusCode).toBe(204)
    // Release is idempotent: a beacon cannot read a response (ADR-021).
    expect((await release(id, editor)).statusCode).toBe(204)
  })

  it('refuses a lock to someone who may only read', async () => {
    const id = await newDocument('Read only')
    const response = await acquire(id, viewer)
    expect(response.statusCode).toBe(403)
  })

  it('returns 409 held when a second editor tries to acquire an active lock', async () => {
    const id = await newDocument('Contended')
    expect((await acquire(id, editor)).statusCode).toBe(200)

    const second = await acquire(id, admin)
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('held')
  })

  it('returns 404 for a draft that does not exist', async () => {
    const id = await newDocument('No draft')
    await harness.database.pool.query('DELETE FROM drafts WHERE document_id = $1', [id])
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/documents/${id}/draft`,
      cookies: editor,
    })
    expect(response.statusCode).toBe(404)
  })

  it('returns 404 on a write when a valid lock exists but the draft row is missing', async () => {
    const id = await newDocument('Missing draft row')
    await harness.database.pool.query('DELETE FROM drafts WHERE document_id = $1', [id])
    await acquire(id, editor)

    expect((await writeDraft(id, editor, { ast: {}, expectedVersion: 0 })).statusCode).toBe(404)
  })

  it('returns 423 lock_lost on a draft write with no lock held', async () => {
    const id = await newDocument('Unlocked write')
    const write = await writeDraft(id, editor, { ast: {}, expectedVersion: 0 })
    expect(write.statusCode).toBe(423)
    expect(write.json().error.code).toBe('lock_lost')
  })

  it('returns 409 stale_version when the expected version is behind', async () => {
    const id = await newDocument('Stale draft')
    await acquire(id, editor)
    await writeDraft(id, editor, { ast: { text: 'v1' }, expectedVersion: 0 })

    const stale = await writeDraft(id, editor, { ast: { text: 'v2' }, expectedVersion: 0 })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('stale_version')
  })

  it('returns 410 expired then 409 taken_over on heartbeat', async () => {
    const id = await newDocument('Expiring lock')
    await acquire(id, editor)

    harness.clock.advance(61_000)
    const expired = await heartbeat(id, editor)
    expect(expired.statusCode).toBe(410)
    expect(expired.json().error.code).toBe('expired')

    await acquire(id, admin)
    const takenOver = await heartbeat(id, editor)
    expect(takenOver.statusCode).toBe(409)
    expect(takenOver.json().error.code).toBe('taken_over')
  })

  it('returns 404 released on heartbeat after release', async () => {
    const id = await newDocument('Released lock')
    await acquire(id, editor)
    await release(id, editor)

    const response = await heartbeat(id, editor)
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('released')
  })

  it('lets an administrator take over an active lock, and forbids an editor', async () => {
    const id = await newDocument('Taken over')
    await acquire(id, editor)

    expect(
      (
        await harness.app.inject({
          method: 'POST',
          url: `/api/documents/${id}/lock/takeover`,
          cookies: editor,
        })
      ).statusCode,
    ).toBe(403)

    const takeover = await harness.app.inject({
      method: 'POST',
      url: `/api/documents/${id}/lock/takeover`,
      cookies: admin,
    })
    expect(takeover.statusCode).toBe(200)

    // The previous holder's next write is rejected (ADR-021).
    expect((await writeDraft(id, editor, { ast: {}, expectedVersion: 0 })).statusCode).toBe(423)
  })

  it('404s a takeover of an unknown document', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/documents/00000000-0000-4000-8000-0000000000ff/lock/takeover',
      cookies: admin,
    })
    expect(response.statusCode).toBe(404)
  })
})

/**
 * Review finding H4. A lock is not a substitute for a permission check: the
 * old code resolved `edit` when the lock was acquired and never again, so a
 * revoked editor went on heartbeating and writing until their browser closed.
 */
describe('a holder who loses the capability', () => {
  async function denyEditor(documentId: DocumentId): Promise<void> {
    const granted = await createGrant(harness.deps, {
      principalKind: 'user',
      principalId: tenancy.editor,
      scopeKind: 'document',
      scopeId: documentId,
      role: 'viewer',
      effect: 'deny',
      createdBy: tenancy.admin,
    })
    if (granted.kind !== 'created') throw new Error(`fixture grant rejected: ${granted.kind}`)
  }

  it('is refused on heartbeat, and its lock is released for whoever may still edit', async () => {
    const id = await newDocument('Revoked mid-session')
    expect((await acquire(id, editor)).statusCode).toBe(200)

    await denyEditor(id)

    const beat = await heartbeat(id, editor)
    expect(beat.statusCode).toBe(403)
    // Not merely refused: the lock went with the capability, so the document
    // is available now rather than in a minute's time.
    expect(await harness.deps.uow.repos.locks.find(id)).toBeNull()
  })

  it('is refused on a draft write, and its lock is released', async () => {
    const id = await newDocument('Revoked mid-write')
    expect((await acquire(id, editor)).statusCode).toBe(200)

    await denyEditor(id)

    const write = await writeDraft(id, editor, { ast: {}, expectedVersion: 0 })
    expect(write.statusCode).toBe(403)
    expect(await harness.deps.uow.repos.locks.find(id)).toBeNull()
  })

  it('still refuses a reader who never held the lock, without disturbing the holder', async () => {
    const id = await newDocument('Held by an editor')
    expect((await acquire(id, editor)).statusCode).toBe(200)

    // A viewer has no `edit`, so the re-check refuses; releasing is by
    // session, so the editor's lock is untouched.
    expect((await heartbeat(id, viewer)).statusCode).toBe(403)
    expect(await harness.deps.uow.repos.locks.find(id)).not.toBeNull()
  })
})

/**
 * Review finding L2. A signed-out or rotated session cannot heartbeat, so
 * without this its lock sat on the document for a full TTL blocking everybody
 * else. `document_locks.holder_session_id` now references `sessions.id` with
 * `ON DELETE CASCADE`, so the lock goes when the session does.
 */
describe('a lock whose session is revoked', () => {
  it('is released as soon as the session is', async () => {
    const id = await newDocument('Held by a session about to end')
    const cookies = await harness.cookiesFor(tenancy.editor)
    expect((await acquire(id, cookies)).statusCode).toBe(200)
    const lock = await harness.deps.uow.repos.locks.find(id)
    expect(lock).not.toBeNull()

    await harness.deps.uow.repos.sessions.delete(lock?.holderSessionId ?? '')
    expect(await harness.deps.uow.repos.locks.find(id)).toBeNull()

    // And the document is immediately available to somebody else.
    expect((await acquire(id, editor)).statusCode).toBe(200)
  })
})
