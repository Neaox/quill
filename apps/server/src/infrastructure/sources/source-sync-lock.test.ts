import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { workspaceId } from '@quill/domain'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createPostgresSourceSyncLock } from './source-sync-lock.ts'

/** The single-flight lock of the sync job (ADR-061), against a real Postgres. */

const HANDBOOK = workspaceId('00000000-0000-4000-8000-000000000101')
const OTHER = workspaceId('00000000-0000-4000-8000-000000000102')

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()
}, 30_000)

afterAll(async () => {
  await database.drop()
})

/** A promise and the function that settles it, so a test holds a lock as long as it likes. */
function gate(): { readonly opened: Promise<void>; open(): void } {
  const { promise, resolve } = Promise.withResolvers<void>()
  return { opened: promise, open: () => resolve() }
}

describe('the Postgres source sync lock', () => {
  it('runs the work and answers its value', async () => {
    const lock = createPostgresSourceSyncLock(database.pool)
    expect(await lock.withLock(HANDBOOK, async () => 42)).toEqual({ kind: 'ran', value: 42 })
  })

  it('answers busy at once while another holds the same source, from any connection', async () => {
    const first = createPostgresSourceSyncLock(database.pool)
    // A second instance stands for a second process: the lock is Postgres's, not this object's.
    const second = createPostgresSourceSyncLock(database.pool)
    const held = gate()
    const entered = gate()
    const running = first.withLock(HANDBOOK, async () => {
      entered.open()
      await held.opened
      return 'first'
    })
    await entered.opened

    expect(await second.withLock(HANDBOOK, async () => 'second')).toEqual({ kind: 'busy' })
    expect(await second.withLock(OTHER, async () => 'other')).toEqual({
      kind: 'ran',
      value: 'other',
    })

    held.open()
    expect(await running).toEqual({ kind: 'ran', value: 'first' })
    expect(await second.withLock(HANDBOOK, async () => 'again')).toEqual({
      kind: 'ran',
      value: 'again',
    })
  })

  it('releases the lock when the work fails, and passes the failure on', async () => {
    const lock = createPostgresSourceSyncLock(database.pool)
    await expect(
      lock.withLock(HANDBOOK, async () => {
        throw new Error('fetch failed')
      }),
    ).rejects.toThrow('fetch failed')
    expect(await lock.withLock(HANDBOOK, async () => 'free')).toEqual({
      kind: 'ran',
      value: 'free',
    })
  })

  it('closes the session rather than reusing it when the unlock fails', async () => {
    const release = vi.fn<(error?: Error | boolean) => void>()
    const query = vi
      .fn<(sql: string, values: unknown[]) => Promise<unknown>>()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockRejectedValueOnce(new Error('connection lost'))
    const pool = { connect: async () => ({ query, release }) } as unknown as pg.Pool
    const lock = createPostgresSourceSyncLock(pool)

    expect(await lock.withLock(HANDBOOK, async () => 'done')).toEqual({
      kind: 'ran',
      value: 'done',
    })
    expect(release).toHaveBeenCalledWith(new Error('connection lost'))

    query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockRejectedValueOnce('not an error')
    await lock.withLock(HANDBOOK, async () => 'done')
    expect(release).toHaveBeenLastCalledWith(new Error('not an error'))
  })

  it('returns the session to the pool when the lock is busy', async () => {
    const release = vi.fn<(error?: Error | boolean) => void>()
    const query = vi
      .fn<(sql: string, values: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ rows: [] })
    const pool = { connect: async () => ({ query, release }) } as unknown as pg.Pool
    expect(await createPostgresSourceSyncLock(pool).withLock(HANDBOOK, async () => 1)).toEqual({
      kind: 'busy',
    })
    expect(release).toHaveBeenCalledWith(undefined)
  })
})
