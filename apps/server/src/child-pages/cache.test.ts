import { describe, expect, it, vi } from 'vitest'
import type { ChildPagesStructure, DocumentRow } from '@quill/application'
import {
  createFakeClock,
  createInMemoryUnitOfWork,
  aShortId,
} from '@quill/application/test-support'
import {
  createEventBus,
  DOCUMENT_CREATED,
  DOCUMENT_DELETED,
  DOCUMENT_MOVED,
  DOCUMENT_NESTED,
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
} from '@quill/application'
import { documentId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { CHILD_PAGES_CACHE_TTL_MS, createChildPagesCache } from './cache.ts'
import { CHILD_PAGES_EVENTS, subscribeChildPagesInvalidation } from './invalidation.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const id = (n: number): DocumentId =>
  documentId(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

function row(n: number, parent: number | null): DocumentRow {
  return {
    id: id(n),
    shortId: aShortId(n),
    workspaceId: WORKSPACE,
    collectionId: 'guides',
    parentId: parent === null ? null : id(parent),
    slug: `d${String(n)}`,
    path: `guides/d${String(n)}.md`,
    title: `D${String(n)}`,
    status: 'published',
    templateId: null,
    templateVersion: null,
    headRevision: null,
    createdBy: null,
    updatedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** The subtree under `parent`, which sits under `above`, nearest first. */
function structure(
  parent: number,
  above: readonly number[],
  under: readonly number[],
): ChildPagesStructure {
  return {
    collection: null,
    ancestors: [parent, ...above].map((n) => row(n, null)),
    descendants: under.map((n) => row(n, parent)),
    summaries: new Map(),
    more: false,
  }
}

describe('the child pages cache', () => {
  it('keeps a subtree until its time is up', () => {
    const clock = createFakeClock(NOW)
    const cache = createChildPagesCache({ clock, ttlMs: CHILD_PAGES_CACHE_TTL_MS })
    const held = structure(1, [], [2])
    cache.remember('a', held)
    expect(cache.find('a')).toBe(held)
    clock.advance(CHILD_PAGES_CACHE_TTL_MS)
    expect(cache.find('a')).toBeUndefined()
    expect(cache.find('never')).toBeUndefined()
  })

  it('holds nothing when it is switched off', () => {
    const cache = createChildPagesCache({ clock: createFakeClock(NOW), ttlMs: 0 })
    cache.remember('a', structure(1, [], []))
    expect(cache.find('a')).toBeUndefined()
  })

  it('forgets the oldest entry first when it is full, and a rewrite moves an entry to the back', () => {
    const cache = createChildPagesCache({ clock: createFakeClock(NOW), ttlMs: 1000, maxEntries: 2 })
    cache.remember('a', structure(1, [], []))
    cache.remember('b', structure(2, [], []))
    cache.remember('a', structure(1, [], []))
    cache.remember('c', structure(3, [], []))
    expect(cache.find('b')).toBeUndefined()
    expect(cache.find('a')).toBeDefined()
    expect(cache.find('c')).toBeDefined()
  })

  it('drops exactly the entries a document is in, above or below', () => {
    const cache = createChildPagesCache({ clock: createFakeClock(NOW), ttlMs: 1000 })
    cache.remember('root', structure(1, [], [2, 3]))
    cache.remember('child', structure(2, [1], [4]))
    cache.remember('other', structure(9, [], [10]))

    cache.invalidate([id(4)])
    expect(cache.find('child')).toBeUndefined()
    expect(cache.find('root')).toBeDefined()
    expect(cache.find('other')).toBeDefined()

    cache.invalidate([id(1)])
    expect(cache.find('root')).toBeUndefined()
    expect(cache.find('other')).toBeDefined()

    cache.clear()
    expect(cache.find('other')).toBeUndefined()
  })
})

describe('invalidating child pages from the bus', () => {
  async function setUp() {
    const uow = createInMemoryUnitOfWork()
    await Promise.all(
      (
        [
          [1, null],
          [2, 1],
          [3, 2],
          [9, null],
        ] as const
      ).map(([n, parent]) => uow.repos.documents.create({ ...row(n, parent), now: NOW })),
    )
    const cache = createChildPagesCache({ clock: createFakeClock(NOW), ttlMs: 1000 })
    const bus = createEventBus({ onError: vi.fn<(error: unknown) => void>() })
    const unsubscribe = subscribeChildPagesInvalidation(bus, cache, { uow })
    // One payload every event's reader accepts: what each needs besides the document.
    const announce = (type: string, named: string) =>
      bus.publish({
        type,
        payload: {
          version: 1,
          documentId: named,
          workspaceId: WORKSPACE,
          title: 'A page',
          createdBy: 'someone',
          revision: 'r',
          publishedBy: 'someone',
          to: 'A page',
        },
      })
    return { cache, announce, unsubscribe }
  }

  it('listens to every event that changes a list', () => {
    expect(CHILD_PAGES_EVENTS.map((definition) => definition.type)).toEqual([
      DOCUMENT_CREATED,
      DOCUMENT_PUBLISHED,
      DOCUMENT_RENAMED,
      DOCUMENT_MOVED,
      DOCUMENT_NESTED,
      DOCUMENT_DELETED,
    ])
  })

  it('drops the lists above a new page, which held nothing of it yet', async () => {
    const { cache, announce } = await setUp()
    cache.remember('grandparent', structure(1, [], [2]))
    cache.remember('elsewhere', structure(9, [], []))
    // Document 3 is new under 2, which is under 1.
    await announce(DOCUMENT_CREATED, id(3))
    expect(cache.find('grandparent')).toBeUndefined()
    expect(cache.find('elsewhere')).toBeDefined()
  })

  it('drops a list that held a deleted page, which has no ancestors left to read', async () => {
    const { cache, announce } = await setUp()
    cache.remember('listed it', structure(9, [], [42]))
    await announce(DOCUMENT_DELETED, id(42))
    expect(cache.find('listed it')).toBeUndefined()
  })

  it('clears everything for an event naming something that is no document', async () => {
    const { cache, announce } = await setUp()
    cache.remember('a', structure(9, [], []))
    await announce(DOCUMENT_NESTED, 'not-a-uuid')
    expect(cache.find('a')).toBeUndefined()
  })

  it('stops listening when told to', async () => {
    const { cache, announce, unsubscribe } = await setUp()
    cache.remember('listed it', structure(9, [], [42]))
    unsubscribe()
    await announce(DOCUMENT_MOVED, id(42))
    expect(cache.find('listed it')).toBeDefined()
  })
})
