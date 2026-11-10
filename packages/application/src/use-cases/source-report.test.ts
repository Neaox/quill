import { describe, expect, it } from 'vitest'
import { documentId } from '@quill/domain'

import { layoutFromSettings } from './source-layout.ts'
import type { SourceLinks } from './source-links.ts'
import type { PlannedDocument, SourceHeadPlan } from './source-head-plan.ts'
import { reportSource, SOURCE_REPORT_SCHEMA } from './source-report.ts'
import { SOURCE_MANIFEST_PATH } from './source-manifest.ts'

const NONE: SourceLinks = {
  resolved: new Map(),
  images: new Map(),
  targets: new Set(),
  attachments: new Set(),
}

function document(path: string, extra: Partial<PlannedDocument> = {}): PlannedDocument {
  return {
    documentId: documentId('00000000-0000-4000-8000-000000000001'),
    collectionId: 'guides',
    path,
    folder: null,
    generated: false,
    parent: null,
    title: path,
    sortKey: 1,
    markdown: '',
    lineOffset: 0,
    links: NONE,
    ...extra,
  }
}

function planned(overrides: Partial<Extract<SourceHeadPlan, { kind: 'planned' }>> = {}) {
  return {
    kind: 'planned',
    revision: 'r1',
    layout: layoutFromSettings([]),
    collections: [],
    documents: [],
    folders: {
      generated: new Map(),
      indexes: new Map(),
      parents: new Map(),
      folderOf: new Map(),
      leading: new Set(),
    },
    refused: [],
    assets: [],
    brokenLinks: [],
    leftOut: [],
    ...overrides,
  } satisfies SourceHeadPlan
}

describe('reportSource', () => {
  it('reports a manifest that does not read, or that names no workspace for this one', () => {
    const problem = { line: 3, message: 'it is not valid YAML.' }
    expect(
      reportSource({
        plan: {
          kind: 'unreadable',
          revision: 'r1',
          manifestPath: SOURCE_MANIFEST_PATH,
          problem,
          entryMissing: false,
        },
      }),
    ).toEqual({
      schema: SOURCE_REPORT_SCHEMA,
      summary: { errors: 1, warnings: 0, notes: 0, documents: 0, assets: 0 },
      problems: [
        {
          code: 'manifest-invalid',
          severity: 'error',
          path: '.quill/workspace.yaml',
          line: 3,
          message: '.quill/workspace.yaml, line 3: it is not valid YAML.',
        },
      ],
    })
    const missing = reportSource({
      plan: {
        kind: 'unreadable',
        revision: 'r1',
        manifestPath: SOURCE_MANIFEST_PATH,
        problem,
        entryMissing: true,
      },
    })
    expect(missing.problems.map(({ code }) => code)).toEqual(['manifest-entry'])
  })

  it('reports every problem a sync records, in code-point order, with its severity', () => {
    const report = reportSource({
      plan: planned({
        layout: {
          ...layoutFromSettings([]),
          unknownKeys: [{ key: 'audience', line: 7 }],
          notes: [{ line: 4, message: '"collections[0]" has no title, so it is called "Notes".' }],
        },
        documents: [
          document('docs/b.md'),
          document('docs/topic/.quill/folder.md', { generated: true, folder: 'docs/topic' }),
          // Not one a plan makes, but a report names it by its own path.
          document('loose/.quill/folder.md', { generated: true }),
        ],
        folders: {
          generated: new Map(),
          indexes: new Map([
            ['', 'README.md'],
            ['docs/guide', 'docs/guide/index.md'],
          ]),
          parents: new Map(),
          folderOf: new Map(),
          leading: new Set(),
        },
        refused: [
          { path: 'docs/huge.md', revision: 'r1', reason: 'too-large' },
          { path: 'docs/huge.png', revision: 'r1', reason: 'too-large' },
          { path: 'docs/latin1.md', revision: 'r1', reason: 'not-utf8' },
          { path: 'docs/link.md', revision: 'r1', reason: 'symbolic-link' },
          { path: 'docs/link.png', revision: 'r1', reason: 'symbolic-link' },
          { path: 'docs/lies.png', revision: 'r1', reason: 'type-mismatch' },
          { path: 'docs/text.png', revision: 'r1', reason: 'type-not-allowed' },
          { path: 'docs/empty.png', revision: 'r1', reason: 'empty' },
          { path: 'docs/broken.png', revision: 'r1', reason: 'malformed' },
          { path: 'other.md', revision: 'r1', reason: 'outside-collections' },
        ],
        brokenLinks: [{ path: 'docs/b.md', url: './gone.md', revision: 'r1' }],
        leftOut: [
          { path: 'docs/Z.md', pattern: null },
          { path: 'docs/drafts/wip.md', pattern: 'docs/drafts/**' },
          { path: 'packages/CHANGES.md', pattern: null },
        ],
      }),
      rendered: new Map([
        [
          'docs/b.md',
          {
            blockIssues: [
              { block: 'step', message: 'no block is called step', line: 9 },
              { block: 'gallery', message: 'no block is called gallery' },
              { block: 'frame', message: 'no block is called frame' },
              { block: 'endpoint', message: 'path is required', line: 4 },
            ],
            tableShapes: [
              { line: 12, cells: 3, columns: 2 },
              { cells: 1, columns: 2 },
            ],
            incompleteRequiredSections: ['Summary'],
          },
        ],
      ]),
    })
    expect(report.summary).toEqual({ errors: 9, warnings: 9, notes: 9, documents: 3, assets: 0 })
    expect(
      report.problems.map(
        ({ path, line, code, severity }) => `${path}:${line ?? ''} ${severity} ${code}`,
      ),
    ).toEqual([
      '.quill/workspace.yaml:4 note manifest-default',
      '.quill/workspace.yaml:7 warning manifest-unknown-key',
      'README.md: note folder-index',
      // A capital letter sorts before a small one, whatever the locale.
      'docs/Z.md: note left-out',
      'docs/b.md: warning block-issue',
      'docs/b.md: warning block-issue',
      'docs/b.md: warning link-broken',
      'docs/b.md: warning required-section-empty',
      'docs/b.md: warning table-shape',
      'docs/b.md:4 warning block-issue',
      'docs/b.md:9 warning block-issue',
      'docs/b.md:12 warning table-shape',
      'docs/broken.png: error asset-malformed',
      'docs/drafts/wip.md: note left-out',
      'docs/empty.png: error asset-empty',
      'docs/guide/index.md: note folder-index',
      'docs/huge.md: error file-too-large',
      'docs/huge.png: error asset-too-large',
      'docs/latin1.md: error file-not-utf8',
      'docs/lies.png: error asset-type-mismatch',
      'docs/link.md: error file-symbolic-link',
      'docs/link.png: error file-symbolic-link',
      'docs/text.png: error asset-type-not-allowed',
      'docs/topic: note folder-generated',
      'loose/.quill/folder.md: note folder-generated',
      'other.md: note left-out',
      'packages/CHANGES.md: note left-out',
    ])
    const codes = new Set(report.problems.map(({ code }) => code))
    expect([...codes].toSorted()).toEqual([
      'asset-empty',
      'asset-malformed',
      'asset-too-large',
      'asset-type-mismatch',
      'asset-type-not-allowed',
      'block-issue',
      'file-not-utf8',
      'file-symbolic-link',
      'file-too-large',
      'folder-generated',
      'folder-index',
      'left-out',
      'link-broken',
      'manifest-default',
      'manifest-unknown-key',
      'required-section-empty',
      'table-shape',
    ])
    expect(report.problems.find(({ code }) => code === 'folder-generated')?.path).toBe('docs/topic')
    expect(report.problems.find(({ path }) => path === 'packages/CHANGES.md')?.message).toBe(
      'No collection takes it.',
    )
    expect(report.problems.find(({ path }) => path === 'docs/drafts/wip.md')?.message).toBe(
      'Excluded by docs/drafts/**.',
    )
    const blocks = report.problems.filter(({ code }) => code === 'block-issue')
    expect(blocks.map(({ line, message }) => [line, message])).toEqual([
      [null, 'no block is called frame'],
      [null, 'no block is called gallery'],
      [4, 'path is required'],
      [9, 'no block is called step'],
    ])
  })

  it('gives each line as the line in the repository file, not in the stamped copy', () => {
    const report = reportSource({
      plan: planned({ documents: [document('docs/b.md', { lineOffset: 3 })] }),
      rendered: new Map([
        [
          'docs/b.md',
          {
            blockIssues: [{ block: 'step', message: 'no block is called step', line: 9 }],
            tableShapes: [{ line: 12, cells: 3, columns: 2 }],
            incompleteRequiredSections: [],
          },
        ],
      ]),
    })
    expect(report.problems.map(({ code, line }) => [code, line])).toEqual([
      ['block-issue', 6],
      ['table-shape', 9],
    ])
  })
})
