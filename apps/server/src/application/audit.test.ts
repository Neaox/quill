import { describe, expect, it, vi } from 'vitest'
import { createInMemoryUnitOfWork } from '@quill/application/test-support'
import { userId } from '@quill/domain'

import { createFakeClock, createFakeIdGenerator } from '../test-support/fakes.ts'
import { AUDIT_EVENTS, createAuditRecorder, recordInBackground } from './audit.ts'
import type { AuditRecorder } from './audit.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const ADA = userId('00000000-0000-4000-8000-000000000001')

function setUp() {
  const uow = createInMemoryUnitOfWork()
  const written: unknown[] = []
  const audited = {
    ...uow,
    repos: {
      ...uow.repos,
      audit: {
        async write(input: unknown): Promise<void> {
          written.push(input)
        },
      },
    },
  }
  return {
    written,
    recorder: createAuditRecorder({
      uow: audited,
      clock: createFakeClock(NOW),
      ids: createFakeIdGenerator(),
    }),
  }
}

describe('createAuditRecorder', () => {
  it('writes an event with the clock’s time and a generated id', async () => {
    const { recorder, written } = setUp()
    await recorder.record({
      type: AUDIT_EVENTS.signInSucceeded,
      actorUserId: ADA,
      targetType: 'session',
      targetId: 'session-1',
      metadata: { method: 'password' },
    })
    expect(written).toEqual([
      {
        id: expect.any(String),
        type: 'auth.sign_in.succeeded',
        actorUserId: ADA,
        targetType: 'session',
        targetId: 'session-1',
        metadata: { method: 'password' },
        now: NOW,
      },
    ])
  })

  it('defaults the metadata to an empty object', async () => {
    const { recorder, written } = setUp()
    await recorder.record({
      type: AUDIT_EVENTS.signOut,
      actorUserId: null,
      targetType: 'session',
      targetId: 'session-1',
    })
    expect(written[0]).toMatchObject({ metadata: {} })
  })
})

describe('recordInBackground', () => {
  it('returns before the write settles, and still writes', async () => {
    const { recorder, written } = setUp()
    const log = { warn: vi.fn<(details: object, message: string) => void>() }
    expect(
      recordInBackground(
        recorder,
        { type: 'x', actorUserId: null, targetType: 'y', targetId: 'z' },
        log,
      ),
    ).toBeUndefined()
    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(log.warn).not.toHaveBeenCalled()
  })

  /**
   * The path this exists for refuses the request either way; a failed audit
   * write must be visible rather than thrown into an already-failing handler.
   */
  it('logs a failed write instead of rejecting', async () => {
    const failing: AuditRecorder = {
      async record(): Promise<void> {
        throw new Error('database is down')
      },
    }
    const log = { warn: vi.fn<(details: object, message: string) => void>() }
    recordInBackground(
      failing,
      { type: 'x', actorUserId: null, targetType: 'y', targetId: 'z' },
      log,
    )
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledTimes(1))
    expect(log.warn).toHaveBeenCalledWith({ err: expect.any(Error) }, 'audit write failed')
  })
})
