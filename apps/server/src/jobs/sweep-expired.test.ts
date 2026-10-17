import { describe, expect, it } from 'vitest'
import { userId } from '@quill/domain'
import { createInMemoryUnitOfWork } from '@quill/application/test-support'

import { createFakeClock } from '../test-support/fakes.ts'
import { createSweepJob, SWEEP_INTERVAL_MS, sweepExpired } from './sweep-expired.ts'

/**
 * Review finding M15. Both clocks are already enforced when somebody
 * *presents* a session, and a spent token is refused on sight — but a row
 * nobody comes back for is never read again, and those are the majority.
 */

const NOW = new Date('2026-03-01T00:00:00.000Z')
const ALICE = userId('00000000-0000-4000-8000-000000000001')
const SESSION = {
  cookieName: 'quill_session',
  linkCookieName: 'quill_link',
  oidcCookieName: 'quill_oidc',
  ttlMs: 30 * 24 * 60 * 60 * 1000,
  idleTtlMs: 7 * 24 * 60 * 60 * 1000,
  secureCookie: false,
}

function days(count: number): number {
  return count * 24 * 60 * 60 * 1000
}

async function setUp() {
  const uow = createInMemoryUnitOfWork()
  const clock = createFakeClock(NOW)
  await uow.repos.users.create({ id: ALICE, email: 'a@example.com', displayName: 'A', now: NOW })
  return { uow, clock, deps: { uow, clock, session: SESSION } }
}

describe('sweepExpired', () => {
  it('removes a session past its absolute lifetime', async () => {
    const { uow, deps } = await setUp()
    await uow.repos.sessions.create({
      id: 'stale',
      userId: ALICE,
      tokenHash: 'hash-stale',
      now: new Date(NOW.getTime() - days(40)),
      expiresAt: new Date(NOW.getTime() - days(10)),
    })

    expect(await sweepExpired(deps, NOW)).toEqual({
      sessions: 1,
      magicLinks: 0,
      documentViews: 0,
      notifications: 0,
    })
    expect(await uow.repos.sessions.findById('stale')).toBeNull()
  })

  it('removes a session nobody has come back to inside the idle window', async () => {
    const { uow, deps } = await setUp()
    const created = await uow.repos.sessions.create({
      id: 'idle',
      userId: ALICE,
      tokenHash: 'hash-idle',
      now: new Date(NOW.getTime() - days(20)),
      expiresAt: new Date(NOW.getTime() + days(10)),
    })
    // Last seen three weeks ago: well past the seven-day idle deadline the
    // session service applies on every authenticated request.
    await uow.repos.sessions.touch(created.id, new Date(NOW.getTime() - days(21)))

    expect((await sweepExpired(deps, NOW)).sessions).toBe(1)
    expect(await uow.repos.sessions.findById('idle')).toBeNull()
  })

  it('leaves a live session alone', async () => {
    const { uow, deps } = await setUp()
    await uow.repos.sessions.create({
      id: 'live',
      userId: ALICE,
      tokenHash: 'hash-live',
      now: NOW,
      expiresAt: new Date(NOW.getTime() + days(30)),
    })

    expect(await sweepExpired(deps, NOW)).toEqual({
      sessions: 0,
      magicLinks: 0,
      documentViews: 0,
      notifications: 0,
    })
    expect(await uow.repos.sessions.findById('live')).not.toBeNull()
  })

  it('removes spent and expired magic links, and keeps a live one', async () => {
    const { uow, deps } = await setUp()
    const link = (
      id: string,
      expiresAt: Date,
    ): Parameters<typeof uow.repos.magicLinks.create>[0] => ({
      id,
      userId: ALICE,
      tokenHash: `hash-${id}`,
      purpose: 'sign-in',
      now: NOW,
      expiresAt,
    })
    const inFifteenMinutes = new Date(NOW.getTime() + 15 * 60_000)
    await uow.repos.magicLinks.create(link('expired', new Date(NOW.getTime() - 60_000)))
    const spent = await uow.repos.magicLinks.create(link('spent', inFifteenMinutes))
    await uow.repos.magicLinks.consume(spent.id, NOW)
    await uow.repos.magicLinks.create(link('live', inFifteenMinutes))

    expect((await sweepExpired(deps, NOW)).magicLinks).toBe(2)
    expect(await uow.repos.magicLinks.findByTokenHash('hash-live')).not.toBeNull()
    expect(await uow.repos.magicLinks.findByTokenHash('hash-spent')).toBeNull()
  })
})

describe('sweepExpired: what people opened', () => {
  it('forgets a view older than ninety days and keeps a recent one', async () => {
    const { uow, deps } = await setUp()
    const view = (documentId: string, at: Date) =>
      uow.repos.documentViews.touch({
        userId: ALICE,
        documentId: documentId as never,
        workspaceId: 'workspace' as never,
        now: at,
        debounceBefore: new Date(0),
      })
    await view('old', new Date(NOW.getTime() - days(91)))
    await view('recent', new Date(NOW.getTime() - days(89)))

    expect((await sweepExpired(deps, NOW)).documentViews).toBe(1)
    expect(
      (
        await uow.repos.documentViews.listRecent({ userId: ALICE, since: new Date(0), limit: 10 })
      ).map((row) => row.documentId),
    ).toEqual(['recent'])
  })
})

describe('sweepExpired: notifications', () => {
  it('forgets a notification older than ninety days and keeps a recent one', async () => {
    const { uow, deps } = await setUp()
    const notification = (id: string, createdAt: Date) => ({
      id,
      recipientUserId: ALICE,
      kind: 'review-requested' as const,
      documentId: 'document' as never,
      requestId: id,
      actorUserId: null,
      createdAt,
    })
    await uow.repos.notifications.insertMany([
      notification('old', new Date(NOW.getTime() - days(91))),
      notification('recent', new Date(NOW.getTime() - days(89))),
    ])

    expect((await sweepExpired(deps, NOW)).notifications).toBe(1)
    expect(
      (await uow.repos.notifications.listForUser({ userId: ALICE, after: null, limit: 10 })).map(
        (row) => row.id,
      ),
    ).toEqual(['recent'])
  })
})

describe('createSweepJob', () => {
  it('is an hourly job the runner can schedule', async () => {
    const { uow, deps } = await setUp()
    await uow.repos.sessions.create({
      id: 'stale',
      userId: ALICE,
      tokenHash: 'hash-stale',
      now: new Date(NOW.getTime() - days(40)),
      expiresAt: new Date(NOW.getTime() - days(10)),
    })

    const job = createSweepJob(deps)
    expect(job).toMatchObject({ name: 'sweep-expired', intervalMs: SWEEP_INTERVAL_MS })
    await job.run(NOW)
    expect(await uow.repos.sessions.findById('stale')).toBeNull()
  })
})
