import { describe, expect, it } from 'vitest'
import { documentId } from '@quill/domain'

import type { SourceCollection } from '../ports/source-sync.ts'
import { FakeSource } from '../test-support/fake-external-source.ts'
import type { FileSpec } from '../test-support/fake-external-source.ts'
import {
  createFakeDocumentFormat,
  createFakeSettings,
  createInMemoryBlobStore,
  pngFile,
  serialise,
} from '../test-support/index.ts'
import { organisationVocabulary } from './render-document.ts'
import { plannedRenderInput, planSourceHead } from './source-head-plan.ts'
import type { SourceHeadPlanDependencies } from './source-head-plan.ts'

const MANIFEST = '.quill/workspace.yaml'
const GUIDES = '00000000-0000-4000-8000-0000000000c1'

function dependencies(): SourceHeadPlanDependencies {
  let next = 0
  const attachments = new Map<string, string>()
  return {
    format: createFakeDocumentFormat(),
    blobStore: createInMemoryBlobStore(),
    drawingText: { read: async () => null },
    maxAssetBytes: 64 * 1024,
    ids: {
      document: (path) => documentId(uuid(`d-${path}`)),
      collection: (slug) => uuid(`c-${slug}`) as never,
      attachment: (sha256) => {
        const known = attachments.get(sha256) ?? `a${(next += 1)}`
        attachments.set(sha256, known)
        return known
      },
    },
  }
}

/** A stable UUID for a name, so ids read the same on every run. */
function uuid(name: string): string {
  let hash = 0
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return `00000000-0000-4000-8000-${hash.toString(16).padStart(12, '0')}`
}

async function plan(
  files: Record<string, FileSpec>,
  options: { readonly collections?: readonly SourceCollection[]; readonly entry?: string } = {},
) {
  const source = new FakeSource([{ id: 'r1', files }])
  const deps = dependencies()
  const planned = await planSourceHead(deps, source, {
    revision: 'r1',
    collections: options.collections ?? [],
    entry: options.entry ?? 'handbook',
    links: {
      remote: 'https://github.com/acme/handbook.git',
      outsideLinks: 'forge',
      viewTemplate: null,
    },
  })
  return { planned, deps, source }
}

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'

describe('planSourceHead', () => {
  it('stops at a manifest that does not read, and says whether it named no workspace', async () => {
    const broken = await plan({ [MANIFEST]: 'version: 1\ncollections: [' })
    expect(broken.planned).toMatchObject({
      kind: 'unreadable',
      revision: 'r1',
      entryMissing: false,
    })

    const elsewhere = await plan({
      [MANIFEST]: [
        'version: 1',
        'workspaces:',
        '  - slug: one',
        '    collections: [{ slug: a, path: docs, title: A }]',
        '  - slug: two',
        '    collections: [{ slug: b, path: docs, title: B }]',
      ].join('\n'),
    })
    expect(elsewhere.planned).toMatchObject({ kind: 'unreadable', entryMissing: true })
  })

  it('places files by the settings when there is no manifest, folders and order included', async () => {
    const { planned, source } = await plan(
      {
        'docs/b.md': '# Bravo',
        'docs/a.md': serialise({ order: 5 }, '# Alpha'),
        'docs/topic/c.md': '# Charlie\n\n[Back](../a.md) [Gone](../gone.md) [Out](../../../x.md)',
        'docs/notes.txt': 'not Markdown',
      },
      { collections: [{ collectionId: GUIDES, path: 'docs' }] },
    )
    if (planned.kind !== 'planned') throw new Error(planned.kind)
    expect(source.narrowed.at(-1)).toEqual([MANIFEST, 'docs'])
    expect(planned.collections.map(({ id }) => id)).toEqual([GUIDES])
    expect(
      planned.documents.map(({ path, parent, generated, folder }) => ({
        path,
        parent,
        generated,
        folder,
      })),
    ).toEqual([
      { path: 'docs/a.md', parent: null, generated: false, folder: null },
      { path: 'docs/b.md', parent: null, generated: false, folder: null },
      { path: 'docs/topic/.quill/folder.md', parent: null, generated: true, folder: 'docs/topic' },
      {
        path: 'docs/topic/c.md',
        parent: 'docs/topic/.quill/folder.md',
        generated: false,
        folder: null,
      },
    ])
    expect(planned.documents.find(({ path }) => path === 'docs/a.md')?.sortKey).toBe(5)
    expect(planned.brokenLinks.map(({ path, url }) => `${path} ${url}`)).toEqual([
      'docs/topic/c.md ../../../x.md',
      'docs/topic/c.md ../gone.md',
    ])
    expect(planned.leftOut).toEqual([])
  })

  it('reads the manifest: collections by slug, files it leaves out, and its assets', async () => {
    const { planned, deps } = await plan({
      [MANIFEST]: [
        'version: 1',
        'collections:',
        '  - { slug: guides, path: docs/guides, title: Guides }',
        "  - { slug: packages, path: 'packages/**/README.md', title: Packages }",
        'exclude: [docs/guides/drafts/**]',
        'assets: [docs/assets/**]',
      ].join('\n'),
      'docs/guides/a.md': '# A\n\n![Logo](../assets/logo.png) ![Map](../assets/map.svg)',
      'docs/guides/drafts/wip.md': '# WIP',
      'packages/api/README.md': '# API',
      'packages/api/CHANGELOG.md': '# Changes',
      'docs/assets/logo.png': { kind: 'bytes', bytes: pngFile() },
      'docs/assets/copy.png': { kind: 'bytes', bytes: pngFile() },
      'docs/assets/map.svg': svg,
      'docs/assets/empty.png': '',
      'docs/assets/huge.png': { kind: 'too-large' },
      'docs/assets/link.png': { kind: 'symbolic-link', target: 'logo.png' },
    })
    if (planned.kind !== 'planned') throw new Error(planned.kind)
    expect(planned.collections.map(({ collection }) => collection.path)).toEqual([
      'docs/guides',
      'packages/**/README.md',
    ])
    expect(planned.leftOut).toEqual([
      { path: 'docs/guides/drafts/wip.md', pattern: 'docs/guides/drafts/**' },
      { path: 'packages/api/CHANGELOG.md', pattern: null },
    ])
    expect(planned.assets.map(({ path, attachmentId }) => [path, attachmentId])).toEqual([
      ['docs/assets/copy.png', 'a1'],
      ['docs/assets/logo.png', 'a1'],
      ['docs/assets/map.svg', 'a2'],
    ])
    expect(planned.refused.map(({ path, reason }) => `${path} ${reason}`)).toEqual([
      'docs/assets/empty.png empty',
      'docs/assets/huge.png too-large',
      'docs/assets/link.png symbolic-link',
    ])

    const page = planned.documents.find(({ path }) => path === 'docs/guides/a.md')
    if (page === undefined) throw new Error('no page')
    const input = await plannedRenderInput(planned, page, {
      blobStore: deps.blobStore,
      vocabulary: await organisationVocabulary(createFakeSettings()),
    })
    expect([...(input.resolvedImages ?? new Map()).values()]).toEqual([
      { kind: 'href', href: '/api/attachments/a1' },
      { kind: 'href', href: '/api/attachments/a2' },
    ])
    expect([...input.drawings.keys()]).toEqual(['/api/attachments/a2'])
  })

  it('gives a document the titles of the documents its links resolve to', async () => {
    const { planned, deps } = await plan(
      {
        'docs/a.md': '# Alpha\n\nSee [b](b.md) and [nowhere](https://example.com).',
        'docs/b.md': '# Bravo',
      },
      { collections: [{ collectionId: GUIDES, path: 'docs' }] },
    )
    if (planned.kind !== 'planned') throw new Error(planned.kind)
    const [alpha, bravo] = planned.documents
    if (alpha === undefined || bravo === undefined) throw new Error('missing')
    const input = await plannedRenderInput(planned, alpha, {
      blobStore: deps.blobStore,
      vocabulary: { labels: new Set() },
    })
    expect([...input.linkTitles]).toEqual([[bravo.documentId, 'Bravo']])
    const plain = await plannedRenderInput(planned, bravo, {
      blobStore: deps.blobStore,
      vocabulary: { labels: new Set() },
    })
    expect(plain.resolvedLinks).toBeUndefined()
    expect(plain.linkTitles.size).toBe(0)
  })
})
