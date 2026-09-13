import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'
import type { RenderedContent } from '../ports/document-format.ts'

import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import type { FakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat } from '../test-support/fake-document-format.ts'
import {
  aShortId,
  createFakeClock,
  createFakeHasher,
  createFakeIdGenerator,
} from '../test-support/fakes.ts'
import { createInMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import type { InMemoryUnitOfWork } from '../test-support/in-memory-repositories.ts'
import { createDocument } from './create-document.ts'
import { publishDocument, readDraftContent } from './publish-document.ts'
import {
  RENDER_VERSION,
  renderCacheKey,
  renderDigest,
  renderDocument,
  resolveLinks,
} from './render-document.ts'
import { restoreRevision } from './restore-revision.ts'
import type { RenderDocumentDependencies } from './render-document.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const AUTHOR = userId('00000000-0000-4000-8000-000000000001')
const MISSING = documentId('00000000-0000-4000-8000-0000000009ff')

const author = { userId: AUTHOR, name: 'Ada', email: 'ada@example.com' }
const SESSION = 'session-ada'

let uow: InMemoryUnitOfWork
let contentStore: FakeContentStore
let deps: RenderDocumentDependencies

async function publish(title: string, body: string): Promise<DocumentId> {
  const created = await createDocument(deps, {
    workspaceId: WORKSPACE,
    collectionId: 'architecture',
    parentId: null,
    title,
    createdBy: AUTHOR,
  })
  if (created.kind !== 'created') throw new Error(created.kind)
  const content = readDraftContent(created.draft.ast)
  await uow.repos.drafts.init({
    documentId: created.document.id,
    baseRevision: null,
    ast: { ...content, version: 1, frontMatter: content?.frontMatter ?? {}, ast: { body } },
    now: NOW,
  })
  const published = await publishDocument(deps, {
    documentId: created.document.id,
    base: null,
    author,
    sessionId: SESSION,
  })
  if (published.kind !== 'published') throw new Error(published.kind)
  return created.document.id
}

async function republish(id: DocumentId, body: string): Promise<void> {
  const draft = await uow.repos.drafts.find(id)
  const content = readDraftContent(draft?.ast)
  await uow.repos.drafts.init({
    documentId: id,
    baseRevision: draft?.baseRevision ?? null,
    ast: { version: 1, frontMatter: content?.frontMatter ?? {}, ast: { body } },
    now: NOW,
  })
  const published = await publishDocument(deps, {
    documentId: id,
    base: draft?.baseRevision ?? null,
    author,
    sessionId: SESSION,
  })
  if (published.kind !== 'published') throw new Error(published.kind)
}

beforeEach(async () => {
  uow = createInMemoryUnitOfWork()
  contentStore = createFakeContentStore()
  deps = {
    uow,
    contentStore,
    format: createFakeDocumentFormat(),
    clock: createFakeClock(NOW),
    ids: createFakeIdGenerator(),
    hasher: createFakeHasher(),
  }
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Engineering',
    slug: 'engineering',
    now: NOW,
  })
  await uow.repos.collections.create({
    id: 'architecture',
    workspaceId: WORKSPACE,
    name: 'Architecture',
    slug: 'architecture',
    now: NOW,
  })
})

describe('renderCacheKey', () => {
  it('keys an entry by its render input and the render version', () => {
    expect(renderCacheKey('hash')).toBe(`hash:${RENDER_VERSION}`)
    expect(renderCacheKey('hash', 7)).toBe('hash:7')
  })
})

describe('renderDigest', () => {
  it('covers the Markdown and the titles it links to, in whatever order they arrive', () => {
    const first = documentId('00000000-0000-4000-8000-0000000001aa')
    const second = documentId('00000000-0000-4000-8000-0000000001bb')
    const digest = renderDigest({
      markdown: '# One',
      linkTitles: new Map([
        [first, 'Runbook'],
        [second, 'Guide'],
      ]),
    })

    expect(
      renderDigest({
        markdown: '# One',
        linkTitles: new Map([
          [second, 'Guide'],
          [first, 'Runbook'],
        ]),
      }),
    ).toBe(digest)
    expect(renderDigest({ markdown: '# One', linkTitles: new Map([[first, 'Renamed']]) })).not.toBe(
      digest,
    )
    expect(renderDigest({ markdown: '# Two', linkTitles: new Map() })).not.toBe(
      renderDigest({ markdown: '# One', linkTitles: new Map() }),
    )
  })
})

describe('renderDocument', () => {
  it('renders once and serves the cached entry after that', async () => {
    const id = await publish('Overview', '# Overview\n\nThe system in one page.')

    const first = await renderDocument(deps, { documentId: id })
    expect(first.kind).toBe('rendered')
    if (first.kind !== 'rendered') return
    expect(first.cached).toBe(false)
    expect(first.content.html).toContain('The system in one page.')
    expect(first.content.outline.map((entry) => entry.text)).toEqual(['Overview'])
    expect(first.content.text.body).toContain('The system in one page.')
    expect(first.content.slots).toEqual([])

    const second = await renderDocument(deps, { documentId: id })
    expect(second.kind === 'rendered' && second.cached).toBe(true)
    expect(second.kind === 'rendered' && second.key).toBe(first.key)
  })

  it('renders again under a new key when a document it links to is renamed', async () => {
    const target = await publish('Runbook', '# Runbook')
    const id = await publish('Overview', `# Overview\n\nSee [](/d/${target}).`)

    const first = await renderDocument(deps, { documentId: id })
    if (first.kind !== 'rendered') throw new Error(first.kind)
    expect(first.content.html).toContain('[Runbook](/d/')

    await uow.repos.documents.update(target, { title: 'Failover runbook' }, NOW)
    const again = await renderDocument(deps, { documentId: id })
    if (again.kind !== 'rendered') throw new Error(again.kind)
    expect(again.cached).toBe(false)
    expect(again.key).not.toBe(first.key)
    expect(again.content.html).toContain('[Failover runbook](/d/')

    // Nothing was invalidated: the first entry is still there, and still right
    // for the input it was rendered from.
    expect((await uow.repos.renderCache.find(first.key, NOW))?.content.html).toBe(
      first.content.html,
    )
  })

  it('re-indexes the links of a cached body, so a restore does not leave them stale', async () => {
    const id = await publish('Overview', '# Overview\n\n[a](https://example.com)')
    await renderDocument(deps, { documentId: id })
    const [first] = await uow.repos.revisions.listForDocument(id, { limit: 1 })
    if (first === undefined) throw new Error('no revision')

    await republish(id, '# Overview\n\nThe link is gone.')
    await renderDocument(deps, { documentId: id })
    expect(await uow.repos.documentLinks.listForDocument(id)).toEqual([])

    const restored = await restoreRevision(deps, {
      documentId: id,
      revision: first.revision,
      author,
      sessionId: SESSION,
    })
    expect(restored.kind).toBe('published')

    const again = await renderDocument(deps, { documentId: id })
    expect(again.kind === 'rendered' && again.cached).toBe(true)
    expect(await uow.repos.documentLinks.listForDocument(id)).toHaveLength(1)
  })

  /**
   * The public site renders on an anonymous `GET` (ADR-023), and an
   * unauthenticated read must not make the server write — however cheap and
   * however idempotent the write is. The index is maintained by the publish
   * path and by the authenticated reading path, so declining to touch it here
   * never leaves it behind.
   */
  it('leaves the link index alone when the caller says not to touch it', async () => {
    const id = await publish('Overview', '# Overview\n\n[a](https://example.com)')
    const rendered = await renderDocument(deps, { documentId: id, indexLinks: false })
    expect(rendered.kind).toBe('rendered')
    expect(await uow.repos.documentLinks.listForDocument(id)).toEqual([])

    // And the ordinary read still records them.
    await renderDocument(deps, { documentId: id })
    expect(await uow.repos.documentLinks.listForDocument(id)).toHaveLength(1)
  })

  it('reads an entry an older renderer wrote, and renders again rather than serving it', async () => {
    const id = await publish('Overview', '# Overview')
    const first = await renderDocument(deps, { documentId: id })
    if (first.kind !== 'rendered') throw new Error(first.kind)
    await uow.repos.renderCache.save({
      key: first.key,
      documentId: id,
      contentHash: 'hash',
      renderVersion: 1,
      content: { ...first.content, version: 1, html: '<article>version one</article>' },
      now: NOW,
    })

    const again = await renderDocument(deps, { documentId: id })
    expect(again.kind === 'rendered' && again.cached).toBe(false)
    expect(again.kind === 'rendered' && again.content.html).not.toContain('version one')
  })

  it('renders again when the cached entry is not a body this release recognises', async () => {
    const id = await publish('Overview', '# Overview')
    const first = await renderDocument(deps, { documentId: id })
    if (first.kind !== 'rendered') throw new Error(first.kind)

    // A row written by a release this one knows nothing about, and a row that
    // carries a known version but is not a body at all.
    for (const content of [{ version: 99 }, { version: RENDER_VERSION, html: 42 }]) {
      await uow.repos.renderCache.save({
        key: first.key,
        documentId: id,
        contentHash: 'hash',
        renderVersion: RENDER_VERSION,
        content: content as unknown as RenderedContent,
        now: NOW,
      })
      const again = await renderDocument(deps, { documentId: id })
      expect(again.kind === 'rendered' && again.cached).toBe(false)
    }
  })

  it('indexes the links a body carries, resolving the ones that name a document', async () => {
    const target = await publish('Runbook', '# Runbook')
    const source = await publish(
      'Overview',
      `# Overview\n\nSee [the runbook](/d/${target}), [nothing](/d/${MISSING}), ` +
        '[the guide](/guides/on-call) and [the web](https://example.com).',
    )

    await renderDocument(deps, { documentId: source })
    const links = await uow.repos.documentLinks.listForDocument(source)
    expect(links.map((link) => [link.kind, link.targetDocumentId])).toEqual([
      ['document', target],
      ['document', null],
      ['internal', null],
      ['external', null],
    ])
    expect(await uow.repos.documentLinks.listSourcesTargeting(target)).toEqual([source])
  })

  it('resolves a link written with a short key, so backlinks work in either form', async () => {
    const target = await publish('Runbook', '# Runbook')
    const targetRow = await uow.repos.documents.findById(target)
    const source = await publish(
      'Overview',
      `# Overview

See [the runbook](/d/runbook-${targetRow?.shortId ?? ''}) ` +
        `and [gone](/d/gone-${aShortId(99)}).`,
    )

    await renderDocument(deps, { documentId: source })
    expect(
      (await uow.repos.documentLinks.listForDocument(source)).map((link) => [
        link.kind,
        link.targetDocumentId,
      ]),
    ).toEqual([
      ['document', target],
      ['document', null],
    ])
    expect(await uow.repos.documentLinks.listSourcesTargeting(target)).toEqual([source])
  })

  it('leaves the link index alone when an older revision is rendered', async () => {
    const id = await publish('Overview', '# Overview\n\n[a](https://example.com)')
    const [first] = await uow.repos.revisions.listForDocument(id, { limit: 1 })
    await republish(id, '# Overview\n\nThe link is gone.')
    await renderDocument(deps, { documentId: id })
    expect(await uow.repos.documentLinks.listForDocument(id)).toEqual([])

    await renderDocument(deps, { documentId: id, revision: first?.revision })
    expect(await uow.repos.documentLinks.listForDocument(id)).toEqual([])
  })

  it('indexes links when the head revision is named explicitly', async () => {
    const id = await publish('Overview', '# Overview\n\n[a](https://example.com)')
    const document = await uow.repos.documents.findById(id)
    await renderDocument(deps, { documentId: id, revision: document?.headRevision ?? undefined })
    expect(await uow.repos.documentLinks.listForDocument(id)).toHaveLength(1)
  })

  it('reports a document it cannot find and one that has never been published', async () => {
    expect(await renderDocument(deps, { documentId: MISSING })).toEqual({
      kind: 'not-found',
      documentId: MISSING,
    })

    const created = await createDocument(deps, {
      workspaceId: WORKSPACE,
      collectionId: 'architecture',
      parentId: null,
      title: 'Unpublished',
      createdBy: AUTHOR,
    })
    if (created.kind !== 'created') throw new Error(created.kind)
    expect(await renderDocument(deps, { documentId: created.document.id })).toEqual({
      kind: 'unpublished',
      documentId: created.document.id,
    })
  })
})

describe('resolveLinks', () => {
  it('classifies a link that names no document without needing one', () => {
    const links = resolveLinks(
      [{ kind: 'image', url: '/assets/diagram.png', text: 'Diagram', external: false }],
      new Map(),
    )
    expect(links).toEqual([
      {
        kind: 'internal',
        targetDocumentId: null,
        url: '/assets/diagram.png',
        text: 'Diagram',
      },
    ])
  })
})
