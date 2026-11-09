import { describe, expect, it } from 'vitest'
import { documentId } from '@quill/domain'

import {
  layoutFromManifest,
  layoutFromSettings,
  layoutPaths,
  layoutPlacer,
  projectSortKeys,
  readOrder,
} from './source-layout.ts'
import type { Orderable } from './source-layout.ts'
import type { ManifestEntry } from './source-manifest.ts'

const entry: ManifestEntry = {
  slug: null,
  collections: [
    { slug: 'guides', title: 'Guides', path: 'docs', order: 'title' },
    { slug: 'decisions', title: 'Decisions', path: 'docs/adr', order: 'filename' },
    { slug: 'adr-drafts', title: 'Drafts', path: 'docs/adr/*.draft.md', order: 'title' },
    { slug: 'packages', title: 'Packages', path: 'packages/**/README.md', order: 'title' },
  ],
  exclude: ['docs/private', 'docs/**/*.wip.md'],
  assets: [],
  redirects: [['docs/old.md', 'docs/new.md']],
}

describe('layouts', () => {
  it('read a manifest entry, with its redirects and the keys it did not read', () => {
    const layout = layoutFromManifest(entry, [{ key: 'theme', line: 3 }])
    expect(layout.origin).toBe('manifest')
    expect(layout.redirects.get('docs/old.md')).toBe('docs/new.md')
    expect(layout.unknownKeys).toEqual([{ key: 'theme', line: 3 }])
    expect(layoutPaths(layout)).toEqual([
      '.quill/workspace.yaml',
      'docs',
      'docs/adr',
      'docs/adr/*.draft.md',
      'packages/**/README.md',
    ])
  })

  it('fetch the asset paths too, and fingerprint them only when there are any', () => {
    const plain = layoutFromManifest(entry)
    const withAssets = layoutFromManifest({ ...entry, assets: ['docs/diagrams'] })
    expect(layoutPaths(withAssets).at(-1)).toBe('docs/diagrams')
    expect(withAssets.fingerprint).not.toBe(plain.fingerprint)
    expect(plain.fingerprint).not.toContain('assets')
  })

  it('fingerprint what places files, whatever order it is written in', () => {
    const reordered = layoutFromManifest({
      ...entry,
      collections: entry.collections.toReversed(),
      exclude: entry.exclude.toReversed(),
    })
    expect(reordered.fingerprint).toBe(layoutFromManifest(entry).fingerprint)
    const retitled = layoutFromManifest({
      ...entry,
      collections: entry.collections.map((collection) => ({ ...collection, title: 'Other' })),
    })
    expect(retitled.fingerprint).not.toBe(layoutFromManifest(entry).fingerprint)
  })

  it('read stored settings as collections ordered by title, a trailing slash dropped', () => {
    const layout = layoutFromSettings([
      { collectionId: 'b', path: 'docs/adr/' },
      { collectionId: 'a', path: 'docs' },
    ])
    expect(layout).toMatchObject({
      origin: 'settings',
      collections: [
        { from: 'settings', collectionId: 'b', path: 'docs/adr', order: 'title' },
        { from: 'settings', collectionId: 'a', path: 'docs', order: 'title' },
      ],
      exclude: [],
      unknownKeys: [],
    })
    expect(layout.fingerprint).toBe(
      layoutFromSettings([
        { collectionId: 'a', path: 'docs' },
        { collectionId: 'b', path: 'docs/adr/' },
      ]).fingerprint,
    )
    expect(layout.fingerprint).not.toBe(layoutFromManifest(entry).fingerprint)
  })
})

describe('layoutPlacer', () => {
  const placer = layoutPlacer(layoutFromManifest(entry))
  const slugOf = (path: string) => {
    const collection = placer.place(path)
    return collection?.from === 'manifest' ? collection.slug : collection
  }

  it.each([
    ['docs/setup.md', 'guides'],
    ['docs/adr/0001-auth.md', 'decisions'],
    ['docs/adr/0002.draft.md', 'adr-drafts'],
    ['packages/ui/README.md', 'packages'],
    ['packages/ui/notes.md', null],
    ['docs/private/keys.md', null],
    ['docs/guides/setup.wip.md', null],
    ['elsewhere/a.md', null],
  ])('places %s in %s', (path, slug) => {
    expect(slugOf(path)).toBe(slug)
  })
})

const doc = (
  id: string,
  title: string,
  path: string,
  createdAt: string,
  order: number | null = null,
): Orderable => ({
  id: documentId(`00000000-0000-4000-8000-00000000000${id}`),
  title,
  path,
  createdAt: new Date(createdAt),
  order,
})
const ordered = (keys: readonly { item: Orderable; sortKey: number }[]) =>
  keys.toSorted((left, right) => left.sortKey - right.sortKey).map(({ item }) => item.id.slice(-1))

describe('projectSortKeys', () => {
  const docs = [
    doc('1', 'Zebra', 'docs/b-10.md', '2026-01-02'),
    doc('2', 'apple', 'docs/a-9.md', '2026-01-03'),
    doc('3', 'Mango', 'docs/c-2.md', '2026-01-01'),
  ]
  it.each([
    ['title', ['2', '3', '1']],
    ['filename', ['2', '1', '3']],
    ['newest', ['2', '1', '3']],
    ['oldest', ['3', '1', '2']],
  ] as const)('orders by %s', (rule, expected) => {
    expect(ordered(projectSortKeys(docs, rule))).toEqual(expected)
  })

  it('keeps a front matter order as the key and puts the rest after the largest', () => {
    const keys = projectSortKeys(
      [
        ...docs,
        doc('4', 'Last', 'docs/z.md', '2026-01-01', 20),
        doc('5', 'First', 'x.md', '2026-01-01', -1),
      ],
      'title',
    )
    expect(ordered(keys)).toEqual(['5', '4', '2', '3', '1'])
    expect(keys.map(({ sortKey }) => sortKey).toSorted((left, right) => left - right)).toEqual([
      -1, 20, 21, 22, 23,
    ])
  })

  it('breaks a tie by path, then by id', () => {
    const tied = [
      doc('2', 'Same', 'docs/b.md', '2026-01-01'),
      doc('1', 'Same', 'docs/a.md', '2026-01-01'),
      doc('4', 'Same', 'docs/c.md', '2026-01-01'),
      doc('3', 'Same', 'docs/c.md', '2026-01-01'),
    ]
    expect(ordered(projectSortKeys(tied, 'oldest'))).toEqual(['1', '2', '3', '4'])
  })
})

describe('readOrder', () => {
  it.each([
    [3, 3],
    [-2, -2],
    [1.5, null],
    ['3', null],
    [Number.MAX_SAFE_INTEGER + 1, null],
    [1_000_000_000, 1_000_000_000],
    [-1_000_000_001, null],
    [undefined, null],
  ])('reads %j as %j', (value, order) => {
    expect(readOrder(value)).toBe(order)
  })
})
