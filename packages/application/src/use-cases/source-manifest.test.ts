import { describe, expect, it } from 'vitest'

import {
  describeManifestProblem,
  MAX_MANIFEST_COLLECTIONS,
  MAX_MANIFEST_LIST,
  parseSourceManifest,
  selectManifestEntry,
  SOURCE_MANIFEST_PATH,
} from './source-manifest.ts'
import type { SourceManifest } from './source-manifest.ts'

function read(text: string): SourceManifest {
  const parsed = parseSourceManifest(text)
  if (!parsed.ok) throw new Error(`unexpected problem: ${parsed.problem.message}`)
  return parsed.manifest
}

function problem(text: string): { line: number | null; message: string } {
  const parsed = parseSourceManifest(text)
  if (parsed.ok) throw new Error('expected a problem')
  return parsed.problem
}

const lines = (...all: string[]) => `${all.join('\n')}\n`

describe('parseSourceManifest', () => {
  it('reads the example of ADR-061', () => {
    const manifest = read(
      lines(
        'version: 1',
        'workspaces:',
        '  - slug: handbook',
        '    collections:',
        '      - { slug: guides, path: docs/guides, title: Guides }',
        '      - { slug: decisions, path: docs/adr, title: Decisions, order: filename }',
        "      - { slug: packages, path: 'packages/**/README.md', title: Packages }",
        '    exclude: [docs/guides/drafts/**]',
        '    assets: [docs/diagrams/**]',
        '    redirects: { docs/guides/old-setup.md: docs/guides/setup.md }',
      ),
    )
    expect(manifest).toEqual({
      entries: [
        {
          slug: 'handbook',
          collections: [
            { slug: 'guides', title: 'Guides', path: 'docs/guides', order: 'title' },
            { slug: 'decisions', title: 'Decisions', path: 'docs/adr', order: 'filename' },
            { slug: 'packages', title: 'Packages', path: 'packages/**/README.md', order: 'title' },
          ],
          exclude: ['docs/guides/drafts/**'],
          assets: ['docs/diagrams/**'],
          redirects: [['docs/guides/old-setup.md', 'docs/guides/setup.md']],
        },
      ],
      unknownKeys: [],
    })
  })

  it('reads top-level collections as one workspace, and a number as text', () => {
    const manifest = read(
      lines(
        'version: 1',
        'collections:',
        '  - slug: guides',
        '    path: docs/guides/',
        '    title: 2026',
        '    order: newest',
      ),
    )
    expect(manifest.entries).toEqual([
      {
        slug: null,
        collections: [{ slug: 'guides', title: '2026', path: 'docs/guides', order: 'newest' }],
        exclude: [],
        assets: [],
        redirects: [],
      },
    ])
  })

  it('keeps the keys it does not read, with their lines', () => {
    const manifest = read(
      lines(
        'version: 1',
        'owner: docs-team',
        'workspaces:',
        '  - slug: handbook',
        '    theme: dark',
        '    collections:',
        '      - slug: guides',
        '        path: docs',
        '        title: Guides',
        '        icon: book',
        '2026: planned',
      ),
    )
    expect(manifest.unknownKeys).toEqual([
      { key: 'owner', line: 2 },
      { key: '2026', line: 11 },
      { key: 'workspaces[0].theme', line: 5 },
      { key: 'workspaces[0].collections[0].icon', line: 10 },
    ])
  })

  it.each([
    ['version: 1\ncollections: [', 'not valid YAML'],
    ['- a\n- b\n', 'must be a mapping'],
    ['', 'must be a mapping'],
    ['collections: []\n', 'needs "version: 1"'],
    ['version: 2\ncollections: []\n', 'version 1 only'],
    ['version: 1\n', '"collections" must be a list'],
    ['version: 1\ncollections: []\n', 'at least one collection'],
    ['version: 1\nworkspaces: []\n', '"workspaces" must be a list'],
    ['version: 1\nworkspaces: nope\n', '"workspaces" must be a list'],
    ['version: 1\nworkspaces: [1]\n', 'must be a mapping'],
    [
      'version: 1\nworkspaces: [{ slug: a, collections: [{ slug: g, path: d, title: G }] }]\ncollections: []\n',
      'not both',
    ],
    ['version: 1\ncollections: [nope]\n', 'must be a mapping'],
    ['version: 1\ncollections: [{ path: d, title: G }]\n', '"collections[0].slug" must be text'],
    ['version: 1\ncollections: [{ slug: Not A Slug, path: d, title: G }]\n', 'is not a slug'],
    ['version: 1\ncollections: [{ slug: "", path: d, title: G }]\n', 'is not a slug'],
    ['version: 1\ncollections: [{ slug: g, path: d }]\n', '"collections[0].title" must be text'],
    ['version: 1\ncollections: [{ slug: g, path: d, title: "  " }]\n', 'must be 1 to'],
    ['version: 1\ncollections: [{ slug: g, path: [d], title: G }]\n', 'must be text'],
    ['version: 1\ncollections: [{ slug: g, path: "**/*.md", title: G }]\n', 'no directory'],
    [
      'version: 1\ncollections: [{ slug: g, path: d, title: G, order: random }]\n',
      'must be one of',
    ],
    [
      'version: 1\ncollections: [{ slug: g, path: d, title: G }, { slug: g, path: e, title: E }]\n',
      'two collections have the slug "g"',
    ],
    [
      'version: 1\ncollections: [{ slug: g, path: d, title: G }, { slug: h, path: d, title: H }]\n',
      'two collections read "d"',
    ],
    ['version: 1\ncollections: [{ slug: g, path: d, title: G }]\nexclude: d\n', 'must be a list'],
    ['version: 1\ncollections: [{ slug: g, path: d, title: G }]\nexclude: [1]\n', 'must be a path'],
    [
      'version: 1\ncollections: [{ slug: g, path: d, title: G }]\nexclude: [[a]]\n',
      'must be a path',
    ],
    ['version: 1\ncollections: [{ slug: g, path: d, title: G, order: [a] }]\n', 'must be one of'],
    [
      'version: 1\ncollections: [{ slug: g, path: d, title: G }]\nredirects: { d/a.md: [x] }\n',
      'needs a new path',
    ],
    ['version: 1\ncollections: [{ slug: g, path: d, title: G }]\nexclude: ["/x"]\n', 'plain'],
    ['version: 1\ncollections: [{ slug: g, path: d, title: G }]\nredirects: [a]\n', 'must map'],
    [
      'version: 1\ncollections: [{ slug: g, path: d, title: G }]\nredirects: { "d/*": d/b.md }\n',
      "a redirect's old path",
    ],
    [
      'version: 1\ncollections: [{ slug: g, path: d, title: G }]\nredirects: { d/a.md: 1 }\n',
      'needs a new path',
    ],
    [
      'version: 1\ncollections: [{ slug: g, path: d, title: G }]\nredirects: { d/a.md: d/a.md }\n',
      'to itself',
    ],
    [
      'version: 1\ncollections: [{ slug: g, path: d, title: G }]\nredirects: { d/a.md: d/b.md, d/a.md/: d/c.md }\n',
      'redirected twice',
    ],
    [
      'version: 1\nworkspaces: [{ slug: a, collections: [{ slug: g, path: d, title: G }] }, { slug: a, collections: [{ slug: g, path: d, title: G }] }]\n',
      'two workspaces have the slug "a"',
    ],
    [
      'version: 1\n? [a]\n: b\ncollections: [{ slug: g, path: d, title: G }]\n',
      'every key must be text',
    ],
  ])('refuses %j: %s', (text, message) => {
    expect(problem(text).message).toContain(message)
  })

  it('names the line a problem is on', () => {
    expect(
      problem(
        lines(
          'version: 1',
          'collections:',
          '  - slug: guides',
          '    path: docs',
          '    title: Guides',
          '    order: alphabetical',
        ),
      ),
    ).toEqual({ line: 6, message: expect.stringContaining('"collections[0].order"') })
    expect(problem('version: 1\ncollections: [\n').line).toBe(3)
  })

  it('refuses more collections or paths than it reads', () => {
    const many = Array.from(
      { length: MAX_MANIFEST_COLLECTIONS + 1 },
      (_, index) => `  - { slug: c${index}, path: d${index}, title: C }`,
    )
    expect(problem(lines('version: 1', 'collections:', ...many)).message).toContain('at most')
    const paths = Array.from({ length: MAX_MANIFEST_LIST + 1 }, (_, index) => `  - d/${index}`)
    const base = ['version: 1', 'collections: [{ slug: g, path: d, title: G }]']
    expect(problem(lines(...base, 'exclude:', ...paths)).message).toContain('at most')
    const redirects = Array.from(
      { length: MAX_MANIFEST_LIST + 1 },
      (_, index) => `  d/${index}.md: d/new.md`,
    )
    expect(problem(lines(...base, 'redirects:', ...redirects)).message).toContain('at most')
  })
})

describe('selectManifestEntry', () => {
  const two = read(
    lines(
      'version: 1',
      'workspaces:',
      '  - { slug: handbook, collections: [{ slug: g, path: docs, title: G }] }',
      '  - { slug: public, collections: [{ slug: p, path: public, title: P }] }',
    ),
  )

  it('answers the only entry whatever its slug', () => {
    const one = read('version: 1\ncollections: [{ slug: g, path: d, title: G }]\n')
    expect(selectManifestEntry(one, 'anything')).toEqual({ ok: true, entry: one.entries[0] })
  })

  it("answers the entry with the workspace's slug, and refuses when there is none", () => {
    expect(selectManifestEntry(two, 'public')).toEqual({ ok: true, entry: two.entries[1] })
    expect(selectManifestEntry(two, 'other')).toEqual({
      ok: false,
      problem: { line: null, message: expect.stringContaining('none has the slug "other"') },
    })
  })
})

describe('describeManifestProblem', () => {
  it('names the file and, when it knows it, the line', () => {
    expect(describeManifestProblem(SOURCE_MANIFEST_PATH, { line: 4, message: 'bad.' })).toBe(
      '.quill/workspace.yaml, line 4: bad.',
    )
    expect(describeManifestProblem(SOURCE_MANIFEST_PATH, { line: null, message: 'bad.' })).toBe(
      '.quill/workspace.yaml: bad.',
    )
  })
})
