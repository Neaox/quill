import type { VirtualTreeRow } from '@quill/ui'
import { describe, expect, it } from 'vitest'

import type { TreeChildDto, TreeChildrenPage, TreeLevel } from '../../lib/api/index.ts'
import { buildTreeRows, levelKey, MAX_PAGES_TO_FIND, type PageRead } from './tree-rows.ts'

const child = (id: string, childCount = 0): TreeChildDto => ({
  id,
  shortId: `short-${id}`,
  title: `Title ${id}`,
  slug: `title-${id}`,
  status: 'published',
  childCount,
})

/** Pages by level and cursor: what has arrived. A level not named has not been loaded. */
type Held = Readonly<Record<string, Readonly<Record<string, TreeChildrenPage>>>>

const held =
  (pages: Held, failing: readonly string[] = []) =>
  (level: TreeLevel, cursor: string | null): PageRead => ({
    page: pages[levelKey(level)]?.[cursor ?? '·'],
    failed: failing.includes(levelKey(level)),
  })

function build(
  pages: Held,
  options: {
    open?: readonly string[]
    shown?: Readonly<Record<string, number>>
    current?: { id: string; level: TreeLevel }
    failing?: readonly string[]
    collections?: readonly string[]
  } = {},
) {
  return buildTreeRows({
    collections: (options.collections ?? ['c']).map((id) => ({ id })),
    section: (collection): VirtualTreeRow => ({
      kind: 'section',
      id: `collection:${collection.id}`,
      label: collection.id,
    }),
    node: (node, place): VirtualTreeRow => ({
      kind: 'node',
      id: node.id,
      label: node.title,
      link: { to: `#${node.id}` },
      depth: place.depth,
      position: place.position,
      siblings: place.siblings,
      expandable: node.childCount > 0,
      expanded: place.expanded,
      actions: [],
    }),
    isOpen: (id) => options.open?.includes(id) ?? false,
    pagesShown: (key) => options.shown?.[key] ?? 1,
    read: held(pages, options.failing),
    ...(options.current === undefined ? {} : { current: options.current }),
  })
}

const ids = (built: ReturnType<typeof build>): string[] => built.rows.map(({ id }) => id)

const TOP = 'c|'

describe('buildTreeRows', () => {
  it('is a collection and its first page of documents, in order', () => {
    const built = build({ [TOP]: { '·': { nodes: [child('a'), child('b')] } } })

    expect(ids(built)).toEqual(['collection:c', 'a', 'b'])
    expect(built.rows[1]).toMatchObject({ depth: 0, position: 1, siblings: 2 })
    expect(built.rows[2]).toMatchObject({ position: 2, siblings: 2 })
  })

  it('says it is waiting for a level it has not got, and asks for its first page', () => {
    const built = build({})

    expect(ids(built)).toEqual(['collection:c', 'status:c|'])
    expect(built.rows[1]).toMatchObject({ kind: 'status', label: 'Loading…', busy: true })
    expect(built.wanted).toEqual([{ level: { collectionId: 'c', parentId: null }, cursor: null }])
  })

  it('says so when a level could not be had, rather than waiting for ever', () => {
    const built = build({}, { failing: [TOP] })

    expect(built.rows[1]).toMatchObject({ kind: 'status', busy: false })
  })

  it('shows what is under a document only while it is open, a level deeper', () => {
    const pages: Held = {
      [TOP]: { '·': { nodes: [child('a', 2), child('b')] } },
      'c|a': { '·': { nodes: [child('a1'), child('a2')] } },
    }

    expect(ids(build(pages))).toEqual(['collection:c', 'a', 'b'])
    const open = build(pages, { open: ['a'] })
    expect(ids(open)).toEqual(['collection:c', 'a', 'a1', 'a2', 'b'])
    expect(open.rows[1]).toMatchObject({ expanded: true })
    expect(open.rows[2]).toMatchObject({ depth: 1, position: 1, siblings: 2 })
  })

  it('does not open a document that has nothing under it, whatever it is told', () => {
    const built = build({ [TOP]: { '·': { nodes: [child('a')] } } }, { open: ['a'] })

    expect(built.rows[1]).toMatchObject({ expanded: false })
    expect(built.wanted).toHaveLength(1)
  })

  it('offers more under a level that has more, and says its size is not yet known', () => {
    const built = build({ [TOP]: { '·': { nodes: [child('a'), child('b')], next: 'p2' } } })

    expect(ids(built)).toEqual(['collection:c', 'a', 'b', 'more:c|'])
    expect(built.rows[1]).toMatchObject({ siblings: -1 })
  })

  it('carries on into the next page once it has been asked for', () => {
    const pages: Held = {
      [TOP]: {
        '·': { nodes: [child('a')], next: 'p2' },
        p2: { nodes: [child('b')] },
      },
    }

    const built = build(pages, { shown: { [TOP]: 2 } })

    expect(ids(built)).toEqual(['collection:c', 'a', 'b'])
    expect(built.rows[2]).toMatchObject({ position: 2, siblings: 2 })
    expect(built.wanted.map(({ cursor }) => cursor)).toEqual([null, 'p2'])
  })

  it('shows a loading row under what has arrived while the next page is on its way', () => {
    const pages: Held = { [TOP]: { '·': { nodes: [child('a')], next: 'p2' } } }

    const built = build(pages, { shown: { [TOP]: 2 } })

    expect(ids(built)).toEqual(['collection:c', 'a', 'status:c|'])
  })

  it('pages a level until the document being read is in it, which is how a reader finds their place', () => {
    const pages: Held = {
      [TOP]: {
        '·': { nodes: [child('a')], next: 'p2' },
        p2: { nodes: [child('b')], next: 'p3' },
        p3: { nodes: [child('target')] },
      },
    }

    const built = build(pages, {
      current: { id: 'target', level: { collectionId: 'c', parentId: null } },
    })

    expect(ids(built)).toEqual(['collection:c', 'a', 'b', 'target'])
  })

  it('stops looking for the document being read after a bounded number of pages', () => {
    const endless = (cursor: string | null): TreeChildrenPage => ({
      nodes: [child(`n${cursor ?? ''}`)],
      next: `${cursor ?? ''}+`,
    })
    const read = (_: TreeLevel, cursor: string | null): PageRead => ({
      page: endless(cursor),
      failed: false,
    })

    const built = buildTreeRows({
      collections: [{ id: 'c' }],
      section: (collection) => ({ kind: 'section', id: collection.id, label: collection.id }),
      node: (node, place) => ({
        kind: 'node',
        id: node.id,
        label: node.title,
        link: { to: '#' },
        depth: place.depth,
        position: place.position,
        siblings: place.siblings,
        expandable: false,
        expanded: false,
        actions: [],
      }),
      isOpen: () => false,
      pagesShown: () => 1,
      read,
      current: { id: 'never', level: { collectionId: 'c', parentId: null } },
    })

    expect(built.wanted).toHaveLength(MAX_PAGES_TO_FIND)
    expect(built.rows.at(-1)).toMatchObject({ kind: 'more' })
  })

  it('does the same for each collection', () => {
    const built = build(
      {
        'one|': { '·': { nodes: [child('a')] } },
        'two|': { '·': { nodes: [child('b')] } },
      },
      { collections: ['one', 'two'] },
    )

    expect(ids(built)).toEqual(['collection:one', 'a', 'collection:two', 'b'])
  })
})
