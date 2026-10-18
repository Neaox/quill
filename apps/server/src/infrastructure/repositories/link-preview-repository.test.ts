import { REQUEST_IN_FLIGHT_FOR_MS } from '@quill/domain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../db/test-database.ts'
import { createLinkPreviewRepository } from './link-preview-repository.ts'

let database: TestDatabase
let previews: ReturnType<typeof createLinkPreviewRepository>

const NOW = new Date('2026-10-13T09:00:00.000Z')
const A = 'https://a.example/'
const B = 'https://b.example/'
const DOCUMENT = { version: 1, title: 'A title' }
const later = (milliseconds: number) => new Date(NOW.getTime() + milliseconds)

beforeAll(async () => {
  database = await createTestDatabase()
  previews = createLinkPreviewRepository(database.db)
}, 30_000)

afterAll(async () => {
  await database.drop()
})

beforeEach(async () => {
  await database.pool.query('DELETE FROM link_previews')
})

const find = (keys: string[], scopes = ['public']) => previews.findMany(scopes, keys)

describe('requestFetch', () => {
  it('claims a key nobody has asked for, leaving a pending row', async () => {
    expect(
      await previews.requestFetch({ scope: 'public', keys: [A], now: NOW, force: false }),
    ).toEqual([A])
    expect(await find([A])).toEqual([
      expect.objectContaining({
        scope: 'public',
        key: A,
        state: 'pending',
        requestedAt: NOW,
        document: null,
      }),
    ])
  })

  it('claims many keys in one statement, and each only once', async () => {
    const claimed = await previews.requestFetch({
      scope: 'public',
      keys: [A, B, A],
      now: NOW,
      force: false,
    })
    expect([...claimed].toSorted()).toEqual([A, B])
  })

  it('refuses a key whose request is still in flight, and allows it once the allowance has run out', async () => {
    await previews.requestFetch({ scope: 'public', keys: [A], now: NOW, force: false })
    expect(
      await previews.requestFetch({ scope: 'public', keys: [A], now: later(1000), force: false }),
    ).toEqual([])
    expect(
      await previews.requestFetch({
        scope: 'public',
        keys: [A],
        now: later(REQUEST_IN_FLIGHT_FOR_MS + 1),
        force: false,
      }),
    ).toEqual([A])
  })

  it('lets exactly one of two simultaneous readers claim a key', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        previews.requestFetch({ scope: 'public', keys: [A], now: NOW, force: false }),
      ),
    )
    expect(results.filter((claimed) => claimed.length === 1)).toHaveLength(1)
  })

  it('keeps scopes apart', async () => {
    await previews.requestFetch({ scope: 'public', keys: [A], now: NOW, force: false })
    expect(
      await previews.requestFetch({ scope: 'org:a', keys: [A], now: NOW, force: false }),
    ).toEqual([A])
  })

  it('leaves a stored preview alone when it asks again', async () => {
    await previews.putReady({ scope: 'public', key: A, document: DOCUMENT, now: NOW })
    expect(
      await previews.requestFetch({ scope: 'public', keys: [A], now: later(1000), force: false }),
    ).toEqual([A])
    expect(await find([A])).toEqual([
      expect.objectContaining({
        state: 'ready',
        document: DOCUMENT,
        fetchedAt: NOW,
        requestedAt: later(1000),
      }),
    ])
  })

  it('does not ask for a link that failed recently, unless forced', async () => {
    await previews.putFailure({ scope: 'public', key: A, failure: 'unreachable', now: NOW })
    expect(
      await previews.requestFetch({ scope: 'public', keys: [A], now: later(60_000), force: false }),
    ).toEqual([])
    expect(
      await previews.requestFetch({ scope: 'public', keys: [A], now: later(60_000), force: true }),
    ).toEqual([A])
  })

  it('asks for a failed link again once its hour is up', async () => {
    await previews.putFailure({ scope: 'public', key: A, failure: 'unreachable', now: NOW })
    expect(
      await previews.requestFetch({
        scope: 'public',
        keys: [A],
        now: later(60 * 60 * 1000),
        force: false,
      }),
    ).toEqual([A])
  })

  it('does nothing for no keys', async () => {
    expect(
      await previews.requestFetch({ scope: 'public', keys: [], now: NOW, force: false }),
    ).toEqual([])
  })
})

describe('putReady and putFailure', () => {
  it('stores a preview, clearing the request that asked for it', async () => {
    await previews.requestFetch({ scope: 'public', keys: [A], now: NOW, force: false })
    await previews.putReady({ scope: 'public', key: A, document: DOCUMENT, now: later(5000) })
    expect(await find([A])).toEqual([
      expect.objectContaining({
        state: 'ready',
        document: DOCUMENT,
        failure: null,
        requestedAt: null,
        retryAfter: null,
        fetchedAt: later(5000),
      }),
    ])
  })

  it('replaces an earlier preview and an earlier failure', async () => {
    await previews.putFailure({ scope: 'public', key: A, failure: 'unreachable', now: NOW })
    await previews.putReady({ scope: 'public', key: A, document: DOCUMENT, now: later(1) })
    await previews.putReady({
      scope: 'public',
      key: A,
      document: { version: 1, title: 'Newer' },
      now: later(2),
    })
    expect(await find([A])).toEqual([
      expect.objectContaining({
        state: 'ready',
        document: { version: 1, title: 'Newer' },
        failure: null,
      }),
    ])
  })

  it('drops a stored preview when the link has become restricted', async () => {
    await previews.putReady({ scope: 'public', key: A, document: DOCUMENT, now: NOW })
    await previews.putFailure({ scope: 'public', key: A, failure: 'restricted', now: later(1) })
    expect(await find([A])).toEqual([
      expect.objectContaining({
        state: 'failed',
        failure: 'restricted',
        document: null,
        fetchedAt: later(1),
      }),
    ])
  })

  it('records a failure with the time it may be tried again', async () => {
    await previews.putFailure({ scope: 'public', key: A, failure: 'not_a_page', now: NOW })
    expect(await find([A])).toEqual([
      expect.objectContaining({
        state: 'failed',
        failure: 'not_a_page',
        document: null,
        retryAfter: later(60 * 60 * 1000),
        requestedAt: null,
      }),
    ])
  })

  it('lets a failure replace a pending request', async () => {
    await previews.requestFetch({ scope: 'public', keys: [A], now: NOW, force: false })
    await previews.putFailure({ scope: 'public', key: A, failure: 'unreachable', now: later(1) })
    expect(await find([A])).toEqual([
      expect.objectContaining({ state: 'failed', requestedAt: null }),
    ])
  })

  it('does not let a failed refresh destroy the last good preview', async () => {
    await previews.putReady({ scope: 'public', key: A, document: DOCUMENT, now: NOW })
    await previews.putFailure({ scope: 'public', key: A, failure: 'unreachable', now: later(1000) })
    expect(await find([A])).toEqual([
      expect.objectContaining({
        state: 'ready',
        document: DOCUMENT,
        failure: null,
        fetchedAt: NOW,
        requestedAt: null,
        retryAfter: later(1000 + 60 * 60 * 1000),
      }),
    ])
  })
})

describe('findMany', () => {
  it('reads several keys across several scopes in one go', async () => {
    await previews.putReady({ scope: 'public', key: A, document: DOCUMENT, now: NOW })
    await previews.putReady({
      scope: 'org:a',
      key: A,
      document: { version: 1, title: 'Private' },
      now: NOW,
    })
    await previews.putReady({
      scope: 'org:b',
      key: A,
      document: { version: 1, title: 'Not yours' },
      now: NOW,
    })
    await previews.putReady({ scope: 'public', key: B, document: DOCUMENT, now: NOW })
    const rows = await find([A, B], ['public', 'org:a'])
    expect(rows.map((row) => `${row.scope} ${row.key}`).toSorted()).toEqual([
      `org:a ${A}`,
      `public ${A}`,
      `public ${B}`,
    ])
  })

  it('answers nothing for no scopes or no keys, without a query', async () => {
    expect(await previews.findMany([], [A])).toEqual([])
    expect(await previews.findMany(['public'], [])).toEqual([])
  })

  it('reads a state a later release invented as nothing known yet', async () => {
    await database.pool.query(
      `INSERT INTO link_previews (scope, key, state, fetched_at) VALUES ('public', $1, 'quantum', $2)`,
      [A, NOW],
    )
    expect(await find([A])).toEqual([expect.objectContaining({ state: 'pending' })])
  })
})

describe('deleteFetchedBefore', () => {
  it('forgets rows fetched before the cut-off, in every scope and state, and keeps the rest', async () => {
    await previews.putReady({ scope: 'public', key: A, document: DOCUMENT, now: later(-2000) })
    await previews.putFailure({ scope: 'org:a', key: A, failure: 'unreachable', now: later(-1000) })
    await previews.requestFetch({ scope: 'public', keys: [B], now: later(-3000), force: false })
    await previews.putReady({
      scope: 'public',
      key: 'https://c.example/',
      document: DOCUMENT,
      now: NOW,
    })

    expect(await previews.deleteFetchedBefore(later(-500))).toBe(3)
    expect(await previews.findMany(['public', 'org:a'], [A, B, 'https://c.example/'])).toEqual([
      expect.objectContaining({ key: 'https://c.example/' }),
    ])
  })

  it('says zero when there is nothing to forget', async () => {
    expect(await previews.deleteFetchedBefore(NOW)).toBe(0)
  })
})

const preview = (thumbnail: string | null, favicon: string | null) => ({
  version: 1,
  title: 'T',
  thumbnail:
    thumbnail === null ? null : { hash: thumbnail, width: 1, height: 1, mediaType: 'image/webp' },
  favicon:
    favicon === null ? null : { hash: favicon, width: 1, height: 1, mediaType: 'image/webp' },
})

describe('isImageReferenced', () => {
  const HASH_A = 'a'.repeat(64)
  const HASH_B = 'b'.repeat(64)
  it('knows a picture a stored preview shows as its thumbnail, or as its icon', async () => {
    await previews.putReady({
      scope: 'public',
      key: A,
      document: preview(HASH_A, HASH_B),
      now: NOW,
    })
    expect(await previews.isImageReferenced(HASH_A)).toBe(true)
    expect(await previews.isImageReferenced(HASH_B)).toBe(true)
  })

  it('knows a picture in any scope', async () => {
    await previews.putReady({
      scope: 'policy:x',
      key: A,
      document: preview(HASH_A, null),
      now: NOW,
    })
    expect(await previews.isImageReferenced(HASH_A)).toBe(true)
  })

  it('does not know a hash no preview shows', async () => {
    await previews.putReady({ scope: 'public', key: A, document: preview(HASH_A, null), now: NOW })
    expect(await previews.isImageReferenced(HASH_B)).toBe(false)
    expect(await previews.isImageReferenced('c'.repeat(64))).toBe(false)
  })

  it('does not know a hash that only appears elsewhere in a preview', async () => {
    await previews.putReady({
      scope: 'public',
      key: A,
      document: { version: 1, title: HASH_B, description: HASH_B, thumbnail: null, favicon: null },
      now: NOW,
    })
    expect(await previews.isImageReferenced(HASH_B)).toBe(false)
  })

  it('forgets a picture when its preview is swept', async () => {
    await previews.putReady({
      scope: 'public',
      key: A,
      document: preview(HASH_A, null),
      now: later(-5000),
    })
    await previews.deleteFetchedBefore(NOW)
    expect(await previews.isImageReferenced(HASH_A)).toBe(false)
  })

  it('does not know a picture from a row that holds no preview', async () => {
    await previews.requestFetch({ scope: 'public', keys: [A], now: NOW, force: false })
    expect(await previews.isImageReferenced(HASH_A)).toBe(false)
  })

  it('has an index for each place a picture is kept, so the question is never a scan', async () => {
    const indexes = await database.pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'link_previews' ORDER BY indexname`,
    )
    expect(indexes.rows.map((row: { indexname: string }) => row.indexname)).toEqual(
      expect.arrayContaining(['link_previews_favicon_idx', 'link_previews_thumbnail_idx']),
    )
  })
})
