import { BRAND } from '@quill/brand'

import { pngFile } from './image-fixtures.ts'

/**
 * Repositories a sourced workspace reads (ADR-061), for the parity suite of
 * ADR-062: each is synced by the server's own sync job, and its report,
 * stored tree and rendered bodies are kept as a golden file that every
 * other reading of the same repository (the plan, the command-line tool)
 * must reproduce.
 *
 * Each fixture is one revision. Files are text, raw bytes, or a symbolic
 * link (written into the index, so a checkout that cannot hold one still
 * commits it). The workspace reading them is always `handbook`.
 */

export type SourceFixtureFile =
  | string
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'symbolic-link'; readonly target: string }

export interface SourceFixture {
  readonly description: string
  readonly files: Readonly<Record<string, SourceFixtureFile>>
  /** The source's settings collections, read when the revision has no manifest. */
  readonly collections?: readonly { readonly slug: string; readonly path: string }[]
  /** The adapter's per-file cap, lowered so a fixture can hold a file over it. */
  readonly maxFileBytes?: number
}

export const FIXTURE_WORKSPACE_SLUG = 'handbook'

const MANIFEST = `.${BRAND.slug}/workspace.yaml`

const bytes = (values: readonly number[]): SourceFixtureFile => ({
  kind: 'bytes',
  bytes: Uint8Array.from(values),
})

const image = (): SourceFixtureFile => ({ kind: 'bytes', bytes: pngFile({ width: 2, height: 1 }) })

const crlf = (text: string): string => text.replaceAll('\n', '\r\n')

const SETUP = `# Setting up

Install it, then read [the concepts](./concepts/README.md#tenancy) and [the
deployment notes](deploy.md).

## Steps

1. Clone the repository.
2. Run the script in [src/run.ts](../../src/run.ts).
3. See [a page that is not there](./missing.md).
`

const ROOKWOOD_GUIDE = `---
order: 1
---

# Guide

The guide's pages, in reading order: [concepts](./concepts/), [tenancy](./concepts/tenancy/README.md#who-owns-what)
and the [decisions](../adr/0001-record-decisions.md).

:::details[What this guide is not]
It is not the API reference. See [the code](../../packages/api/README.md).
:::

| Page | What it covers |
| --- | --- |
| [Concepts](./concepts/README.md) | The words used everywhere |
| [Tenancy](./concepts/tenancy/README.md) | Who owns what |

\`\`\`ts
export const answer: number = 42
\`\`\`
`

export const SOURCE_FIXTURES = {
  'settings-collections': {
    description:
      'No manifest: the settings collections place the files. Folders, links to files, folders, anchors, files outside the source and paths that are not there.',
    collections: [{ slug: 'guides', path: 'docs/guides' }],
    files: {
      'docs/guides/setup.md': SETUP,
      'docs/guides/deploy.md': '# Deploying\n\nBack to [setting up](setup.md).\n',
      'docs/guides/concepts/README.md':
        '# Concepts\n\n## Tenancy\n\nEach [folder](./tenancy) has a page.\n',
      'docs/guides/concepts/tenancy/units.md': '# Units\n\nUp to [concepts](../).\n',
      'docs/guides/reference/api.md': '# API\n\nA folder with no index file above it.\n',
      'docs/outside.md': '# Outside\n\nNot under any collection.\n',
      'src/run.ts': 'export {}\n',
    },
  },

  'manifest-layout': {
    description:
      'A manifest: collections by directory, file and glob, filename order, exclude, assets, front matter titles and order, index files over READMEs, a README beside an index, and an unknown key.',
    files: {
      [MANIFEST]: [
        'version: 1',
        'collections:',
        '  - { slug: guides, path: docs/guides, title: Guides }',
        '  - { slug: decisions, path: docs/adr, title: Decisions, order: filename }',
        "  - { slug: packages, path: 'packages/**/README.md', title: Packages }",
        '  - { slug: plan, path: docs/plan.md, title: Plan }',
        'exclude: [docs/guides/drafts/**]',
        'assets: [docs/diagrams/**]',
        'audience: internal',
        '',
      ].join('\n'),
      'docs/guides/index.md': '---\ntitle: The guides\n---\n\nWhere to start.\n',
      'docs/guides/README.md': '# Read me\n\nBeside an index file, an ordinary page.\n',
      'docs/guides/first.md': '---\norder: 2\n---\n\n# First\n',
      'docs/guides/second.md': '---\norder: 1\n---\n\n# Second\n',
      'docs/guides/no-heading.md': 'Just words, so the file name titles it.\n',
      'docs/guides/drafts/wip.md': '# Work in progress\n',
      'docs/guides/topics/index.md': '# Topics\n',
      'docs/guides/topics/README.md': '# Topics read me\n',
      'docs/adr/0002-second.md': '# Second decision\n',
      'docs/adr/0001-first.md': '# First decision\n\n![Flow](../diagrams/flow.png)\n',
      'docs/diagrams/flow.png': image(),
      'docs/plan.md': '# Plan\n',
      'packages/api/README.md': '# The API package\n',
      'packages/api/CHANGELOG.md': '# Not matched by the glob\n',
      'packages/web/README.md': '# The web package\n',
    },
  },

  'manifest-several-workspaces': {
    description: 'A manifest describing two workspaces: the one named handbook is read.',
    files: {
      [MANIFEST]: [
        'version: 1',
        'workspaces:',
        '  - slug: handbook',
        '    collections:',
        '      - { slug: guides, path: docs/guides, title: Guides }',
        '  - slug: public',
        '    collections:',
        '      - { slug: site, path: docs/site, title: Site }',
        '',
      ].join('\n'),
      'docs/guides/a.md': '# A\n\nSee [the site](../site/b.md).\n',
      'docs/site/b.md': '# B\n',
    },
  },

  'manifest-invalid': {
    description: 'A manifest that does not read, with the line it fails on.',
    files: {
      [MANIFEST]: 'version: 1\ncollections:\n  - { slug: guides, path: docs/guides\n',
      'docs/guides/a.md': '# A\n',
    },
  },

  'manifest-no-entry': {
    description: 'A manifest with several workspaces, none of them handbook.',
    files: {
      [MANIFEST]: [
        'version: 1',
        'workspaces:',
        '  - slug: one',
        '    collections: [{ slug: a, path: docs/a, title: A }]',
        '  - slug: two',
        '    collections: [{ slug: b, path: docs/b, title: B }]',
        '',
      ].join('\n'),
      'docs/a/a.md': '# A\n',
    },
  },

  refusals: {
    description:
      'Files the sync refuses: a symbolic link, a file that is not UTF-8, a file over the cap, and assets that are empty, not what their name says, a drawing with its own style, and an image a page shows from inside a collection.',
    maxFileBytes: 4096,
    files: {
      [MANIFEST]: [
        'version: 1',
        'collections:',
        '  - { slug: guides, path: docs/guides, title: Guides }',
        'assets: [docs/assets/**]',
        '',
      ].join('\n'),
      'docs/guides/linked.md': { kind: 'symbolic-link', target: 'real.md' },
      'docs/guides/real.md': [
        '# Real',
        '',
        '![Inline](./inline.png) ![Logo](../assets/logo.png) ![Empty](../assets/empty.png)',
        '![Lies](../assets/lies.png) ![Drawing](../assets/drawing.svg) ![Gone](../assets/gone.png)',
        '',
      ].join('\n'),
      'docs/guides/inline.png': image(),
      'docs/guides/latin1.md': bytes([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a]),
      'docs/guides/huge.md': `# Huge\n\n${'Lorem ipsum dolor sit amet. '.repeat(200)}\n`,
      'docs/assets/logo.png': image(),
      'docs/assets/empty.png': '',
      'docs/assets/lies.png': 'This is text, not a picture.\n',
      'docs/assets/drawing.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>rect{fill:red}</style><rect width="10" height="10"/></svg>\n',
    },
  },

  blocks: {
    description:
      'Component blocks (ADR-060): a block that draws, a prop that does not fit, a required prop missing, an unknown container, and a required section left empty.',
    collections: [{ slug: 'guides', path: 'docs' }],
    files: {
      'docs/api.md': [
        '---',
        'requiredSections: [Summary, Rollback]',
        '---',
        '',
        '# API',
        '',
        '## Summary',
        '',
        '## Rollback',
        '',
        'Roll back by redeploying.',
        '',
        ':::endpoint{method=GET path=/users}',
        'Lists the users.',
        ':::',
        '',
        ':::endpoint{method=FETCH path=/users}',
        'A method that is not one.',
        ':::',
        '',
        ':::endpoint{method=POST}',
        'No path.',
        ':::',
        '',
        '::::gallery',
        ':::frame',
        'Not a block this instance has.',
        ':::',
        '::::',
        '',
      ].join('\n'),
    },
  },

  'line-endings': {
    description: 'The same pages written with CRLF line endings.',
    collections: [{ slug: 'guides', path: 'docs' }],
    files: {
      'docs/setup.md': crlf(
        '# Setting up\n\nSee [deploying](deploy.md#rolling-back).\n\n## Steps\n\n- one\n- two\n',
      ),
      'docs/deploy.md': crlf('# Deploying\n\n## Rolling back\n\nRedeploy.\n'),
    },
  },

  'link-case': {
    description:
      'A link whose case differs from its file: broken in the repository, whatever a disk says.',
    collections: [{ slug: 'guides', path: 'docs' }],
    files: {
      'docs/setup.md': '# Setting up\n\nSee [deploying](./Deploy.md) and [this](./setup.md).\n',
      'docs/deploy.md': '# Deploying\n',
    },
  },

  'sibling-ties': {
    description:
      'Siblings the order rules cannot tell apart (titles and paths equal but for accents): the stored path breaks the tie, whatever id each was given.',
    collections: [{ slug: 'guides', path: 'docs' }],
    files: {
      'docs/résumé.md': '# Résumé',
      'docs/resume.md': '# Resume',
      'docs/rèsume.md': '# Rèsume',
    },
  },

  'shared-folder': {
    description:
      'Two collections in one folder: the first in the manifest writes the folder, the other nests under the nearest folder it has.',
    files: {
      [MANIFEST]: [
        'version: 1',
        'collections:',
        "  - { slug: guides, path: 'docs/**/*.guide.md', title: Guides }",
        "  - { slug: notes, path: 'docs/**/*.note.md', title: Notes }",
        '',
      ].join('\n'),
      'docs/topic/a.guide.md': '# A guide\n',
      'docs/topic/b.note.md': '# A note\n',
      'docs/topic/deeper/c.note.md': '# A deeper note\n',
    },
  },

  'rookwood-shaped': {
    description:
      "A small repository shaped like rookwood's docs: a README in every folder, nested concepts, decisions by file name, details, tables, code, and links across collections.",
    files: {
      [MANIFEST]: [
        'version: 1',
        'workspaces:',
        '  - slug: handbook',
        '    collections:',
        '      - { slug: guide, path: docs/guide, title: Guide }',
        '      - { slug: decisions, path: docs/adr, title: Decisions, order: filename }',
        '',
      ].join('\n'),
      'docs/guide/README.md': ROOKWOOD_GUIDE,
      'docs/guide/concepts/README.md':
        '# Concepts\n\nThe words: [tenancy](tenancy/README.md), [bookings](bookings.md).\n',
      'docs/guide/concepts/bookings.md': '---\ntitle: Bookings and stays\n---\n\nA stay.\n',
      'docs/guide/concepts/tenancy/README.md':
        '# Tenancy\n\n## Who owns what\n\nAn organisation owns its properties.\n',
      'docs/guide/concepts/tenancy/units.md': '# Units\n\nBack to [the guide](../../README.md).\n',
      'docs/guide/howto/connect.md':
        '# Connect a channel\n\nSee [ADR 2](../../adr/0002-channels.md).\n',
      'docs/adr/README.md': '# Decisions\n\nEvery decision, by number.\n',
      'docs/adr/0001-record-decisions.md': '# 1. Record decisions\n',
      'docs/adr/0002-channels.md': '# 2. Channels\n\nSee [the guide](../guide/README.md).\n',
      'packages/api/README.md': '# API\n',
    },
  },
} satisfies Readonly<Record<string, SourceFixture>>

export type SourceFixtureName = keyof typeof SOURCE_FIXTURES
