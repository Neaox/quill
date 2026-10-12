import { beforeEach, describe, expect, it } from 'vitest'
import { documentId, userId, workspaceId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'
import { RENDERED_CONTENT_VERSION } from '../ports/document-format.ts'
import type { RenderedContent } from '../ports/document-format.ts'

import { createFakeContentStore } from '../test-support/fake-content-store.ts'
import { createInMemoryBlobStore } from '../test-support/in-memory-blob-store.ts'
import type { FakeContentStore } from '../test-support/fake-content-store.ts'
import { createFakeDocumentFormat } from '../test-support/fake-document-format.ts'
import { createFakeSettings } from '../test-support/fake-settings.ts'
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
import { defaultOrganisationSettings } from '../settings/documents.ts'
import type { CustomEmojiEntry } from '../settings/emoji.ts'
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
    blobStore: createInMemoryBlobStore(),
    settings: createFakeSettings(),
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

  it('covers the installed extensions, and only when there are any (ADR-039)', () => {
    const input = { markdown: '# One', linkTitles: new Map() }
    expect(renderDigest(input, '')).toBe(renderDigest(input))
    expect(renderDigest(input, 'quill.drawio@1.0.0')).not.toBe(renderDigest(input))
    expect(renderDigest(input, 'quill.drawio@1.0.1')).not.toBe(
      renderDigest(input, 'quill.drawio@1.0.0'),
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
    for (const content of [{ version: 99 }, { version: RENDERED_CONTENT_VERSION, html: 42 }]) {
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

describe('drawings', () => {
  const OTHER_WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000102')
  const LOOP = '<svg viewBox="0 0 10 10"><rect class="box"/></svg>'

  async function attach(
    owner: DocumentId,
    markup: string,
    overrides: { readonly workspaceId?: typeof WORKSPACE; readonly contentType?: string } = {},
  ): Promise<string> {
    const bytes = new TextEncoder().encode(markup)
    const blob = await deps.blobStore.put(
      (async function* () {
        yield bytes
      })(),
      'image/svg+xml',
    )
    const id = deps.ids.uuid()
    await uow.repos.attachments.create({
      id,
      documentId: owner,
      workspaceId: overrides.workspaceId ?? WORKSPACE,
      uploadedBy: AUTHOR,
      filename: 'the-loop.svg',
      contentType: overrides.contentType ?? 'image/svg+xml',
      size: blob.size,
      sha256: blob.hash,
      now: NOW,
    })
    return `/api/attachments/${id}`
  }

  async function bodyOf(id: DocumentId): Promise<string> {
    const rendered = await renderDocument(deps, { documentId: id })
    if (rendered.kind !== 'rendered') throw new Error(rendered.kind)
    return rendered.content.html
  }

  it('hands the renderer the SVG drawings a body shows', async () => {
    const id = await publish('Map', '# Map')
    const url = await attach(id, LOOP)
    await republish(
      id,
      `# Map

![The loop](${url})`,
    )

    expect(await bodyOf(id)).toContain(`<drawing src="${url}">${LOOP}</drawing>`)
  })

  it('draws nothing that belongs to another workspace', async () => {
    const id = await publish('Map', '# Map')
    const url = await attach(id, LOOP, { workspaceId: OTHER_WORKSPACE })
    await republish(
      id,
      `# Map

![The loop](${url})`,
    )

    expect(await bodyOf(id)).not.toContain('<drawing')
  })

  it('draws nothing removed, and nothing that is not a drawing', async () => {
    const id = await publish('Map', '# Map')
    const removed = await attach(id, LOOP)
    await uow.repos.attachments.softDelete(removed.split('/').at(-1) ?? '', NOW)
    const picture = await attach(id, LOOP, { contentType: 'image/png' })
    await republish(
      id,
      `# Map

![a](${removed})

![b](${picture})`,
    )

    expect(await bodyOf(id)).not.toContain('<drawing')
  })

  it('renders afresh when the drawing a body shows is a different one', () => {
    const markdown = '![a](/api/attachments/x)'
    const one = renderDigest({
      markdown,
      linkTitles: new Map(),
      drawings: new Map([['/api/attachments/x', { sha256: 'a', markup: '' }]]),
    })
    const two = renderDigest({
      markdown,
      linkTitles: new Map(),
      drawings: new Map([['/api/attachments/x', { sha256: 'b', markup: '' }]]),
    })

    expect(one).not.toBe(two)
  })
})

describe('drawings, several at once', () => {
  it('hands over every drawing shown, and leaves out one whose bytes are gone', async () => {
    const id = await publish('Map', '# Map')
    const blobs = createInMemoryBlobStore()
    deps = { ...deps, blobStore: blobs }
    const urls: string[] = []
    for (const markup of ['<svg id="one"/>', '<svg id="two"/>', '<svg id="gone"/>']) {
      const bytes = new TextEncoder().encode(markup)
      const blob = await blobs.put(
        (async function* () {
          yield bytes
        })(),
        'image/svg+xml',
      )
      const attachment = deps.ids.uuid()
      await uow.repos.attachments.create({
        id: attachment,
        documentId: id,
        workspaceId: WORKSPACE,
        uploadedBy: AUTHOR,
        filename: 'd.svg',
        contentType: 'image/svg+xml',
        size: blob.size,
        sha256: blob.hash,
        now: NOW,
      })
      urls.push(`/api/attachments/${attachment}`)
      if (markup.includes('gone')) await blobs.delete(blob.hash)
    }
    await republish(id, ['# Map', ...urls.map((url) => `![d](${url})`)].join('\n\n'))

    const rendered = await renderDocument(deps, { documentId: id })
    if (rendered.kind !== 'rendered') throw new Error(rendered.kind)

    expect(rendered.content.html).toContain('<svg id="one"/>')
    expect(rendered.content.html).toContain('<svg id="two"/>')
    expect(rendered.content.html).not.toContain('gone')
  })
})

describe('labels (ADR-037)', () => {
  async function defineLabels(...names: readonly string[]): Promise<void> {
    const read = await deps.settings.readOrganisation()
    const current = read.kind === 'settings' ? read.document : defaultOrganisationSettings()
    const { labels: _labels, ...theme } = current.theme
    const labels = names.map((name) => ({ name, title: name, hue: 10 }))
    const written = await deps.settings.writeOrganisation({
      // A theme with no labels leaves the field out, as every theme saved
      // before labels existed does.
      document: { ...current, theme: labels.length === 0 ? theme : { ...theme, labels } },
      expectedRevision: read.kind === 'settings' ? read.revision : null,
      author,
    })
    if (written.kind !== 'written') throw new Error(written.kind)
  }

  async function rendered(id: DocumentId) {
    const result = await renderDocument(deps, { documentId: id })
    if (result.kind !== 'rendered') throw new Error(result.kind)
    return result
  }

  it('hands the renderer the organisation theme’s label names', async () => {
    const id = await publish('Channels', '# Channels')
    await defineLabels('booking', 'airbnb')

    expect((await rendered(id)).content.html).toContain(
      '<label name="booking"/><label name="airbnb"/>',
    )
  })

  it('renders afresh when the names change, and keeps the key of a body with none', async () => {
    const id = await publish('Channels', '# Channels')
    const before = await rendered(id)
    await defineLabels()
    expect((await rendered(id)).key).toBe(before.key)

    await defineLabels('airbnb')
    const labelled = await rendered(id)
    expect(labelled.key).not.toBe(before.key)
    expect(labelled.cached).toBe(false)

    await defineLabels('airbnb')
    expect((await rendered(id)).cached).toBe(true)
  })

  it('covers the names in sorted order, so their order in the theme is not a new key', () => {
    const input = { markdown: '# A', linkTitles: new Map() }
    expect(renderDigest({ ...input, labels: new Set(['b', 'a']) })).toBe(
      renderDigest({ ...input, labels: new Set(['a', 'b']) }),
    )
    expect(renderDigest({ ...input, labels: new Set<string>() })).toBe(renderDigest(input))
  })

  it('renders without labels when the settings file cannot be read', async () => {
    const id = await publish('Channels', '# Channels')
    await defineLabels('airbnb')
    const settings = createFakeSettings()
    settings.place('organisation', 'not: [valid\n')
    deps = { ...deps, settings }

    expect((await rendered(id)).content.html).not.toContain('<label')
  })
})

describe('emoji (ADR-038)', () => {
  const AIRBNB: CustomEmojiEntry = {
    name: 'airbnb',
    hash: 'a'.repeat(64),
    mediaType: 'image/svg+xml',
    width: 64,
    height: 64,
  }

  async function defineEmoji(
    emoji: readonly CustomEmojiEntry[],
    labels: readonly { name: string; emoji?: string }[] = [],
  ): Promise<void> {
    const read = await deps.settings.readOrganisation()
    const current = read.kind === 'settings' ? read.document : defaultOrganisationSettings()
    const theme =
      labels.length === 0
        ? current.theme
        : {
            ...current.theme,
            labels: labels.map((label) => ({ ...label, title: label.name, hue: 10 })),
          }
    const written = await deps.settings.writeOrganisation({
      document: { ...current, theme, emoji: [...emoji] },
      expectedRevision: read.kind === 'settings' ? read.revision : null,
      author,
    })
    if (written.kind !== 'written') throw new Error(written.kind)
  }

  async function rendered(id: DocumentId) {
    const result = await renderDocument(deps, { documentId: id })
    if (result.kind !== 'rendered') throw new Error(result.kind)
    return result
  }

  it('hands the renderer the organisation’s emoji, and each label’s leading one', async () => {
    const id = await publish('Channels', '# Channels')
    await defineEmoji(
      [AIRBNB, { ...AIRBNB, name: 'booking_com', hash: 'b'.repeat(64) }],
      [{ name: 'airbnb' }, { name: 'booking', emoji: 'booking_com' }, { name: 'vrbo' }],
    )

    expect((await rendered(id)).content.html).toContain(
      '<emoji name="airbnb" src="/api/emoji/airbnb.aaaaaaaaaaaaaaaa.svg"/>' +
        '<emoji name="booking_com" src="/api/emoji/booking_com.bbbbbbbbbbbbbbbb.svg"/>' +
        '<lead label="airbnb" emoji="airbnb"/><lead label="booking" emoji="booking_com"/>',
    )
  })

  it('renders afresh when an image is replaced, and keeps the key of a body with none', async () => {
    const id = await publish('Channels', '# Channels')
    const before = await rendered(id)
    await defineEmoji([])
    expect((await rendered(id)).key).toBe(before.key)

    await defineEmoji([AIRBNB])
    const drawn = await rendered(id)
    expect(drawn.key).not.toBe(before.key)

    await defineEmoji([{ ...AIRBNB, hash: 'c'.repeat(64) }])
    expect((await rendered(id)).key).not.toBe(drawn.key)
  })

  it('renders afresh when what an emoji is said to show changes', () => {
    const input = { markdown: '# A', linkTitles: new Map() }
    const image = { src: '/api/emoji/a.aaaaaaaaaaaaaaaa.png', width: 1, height: 1 }
    const digestOf = (shown: object) =>
      renderDigest({ ...input, emoji: new Map([['a', { ...image, ...shown }]]) })

    expect(digestOf({ description: 'Acme logo' })).not.toBe(
      digestOf({ description: 'A roadrunner' }),
    )
    expect(digestOf({ description: 'Acme logo' })).not.toBe(digestOf({}))
  })

  it('covers emoji and leading emoji in sorted order', () => {
    const input = { markdown: '# A', linkTitles: new Map() }
    const image = { src: '/api/emoji/a.aaaaaaaaaaaaaaaa.png', width: 1, height: 1 }
    expect(
      renderDigest({
        ...input,
        emoji: new Map([
          ['b', image],
          ['a', image],
        ]),
      }),
    ).toBe(
      renderDigest({
        ...input,
        emoji: new Map([
          ['a', image],
          ['b', image],
        ]),
      }),
    )
    expect(renderDigest({ ...input, labelEmoji: new Map([['airbnb', 'airbnb']]) })).not.toBe(
      renderDigest(input),
    )
    expect(renderDigest({ ...input, emoji: new Map(), labelEmoji: new Map() })).toBe(
      renderDigest(input),
    )
  })
})
