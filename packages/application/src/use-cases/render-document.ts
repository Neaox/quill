import type { DocumentId, RevisionId, ShortId } from '@quill/domain'

import type { BlobStore } from '../ports/blob-store.ts'
import { readBlob } from '../ports/blob-store.ts'
import type { ContentStore, DocumentSource } from '../ports/content-store.ts'
import type {
  DocumentFormat,
  DrawingSource,
  ExtractedLink,
  RenderedContent,
  RenderInput,
  ResolvedDestination,
} from '../ports/document-format.ts'
import { RENDERED_CONTENT_VERSION } from '../ports/document-format.ts'
import type {
  AttachmentId,
  DocumentLinkRow,
  DocumentRepository,
  DocumentRow,
  NewDocumentLink,
  UnitOfWork,
} from '../ports/persistence.ts'
import type { Settings } from '../ports/settings.ts'
import type { DocumentWork } from '../ports/document-work.ts'
import type { RenderedEmoji } from '../settings/emoji.ts'
import { customEmojiByName, labelEmoji } from '../settings/emoji.ts'
import type { Clock, Hasher, IdGenerator } from '../ports/system.ts'
import { documentReferenceFromUrl, linkedDocumentReferences } from './document-path.ts'
import { attachmentIdsIn, attachmentUrl } from './attachments.ts'
import { DRAWING_MEDIA_TYPE } from './media-types.ts'
import { readSource } from './read-published.ts'
import type { SourceLinks, SourcePlace } from './source-links.ts'
import { sourceLinksAt } from './source-links.ts'
import { createVersionedReader } from './versioned-reader.ts'

/**
 * The static body of a document (ADR-031).
 *
 * The body is a pure function of its render input — the Markdown, and the
 * current titles of the documents it links to — so it is cached under a key of
 * that input's hash and the render version, and nothing ever invalidates an
 * entry. A publish produces a new key; so does renaming a document this one
 * links to; the old entry simply stops being read. The entry is therefore
 * content-addressed and carries no document identity: two documents rendering
 * the same input share one entry, in the same workspace or in different ones,
 * and see only what their own source already contains.
 */

/**
 * Bumped whenever the renderer's output changes; old entries then stop being
 * read, because the version is part of every key.
 *
 * Version 2 is the first to carry syntax-token ranges the client can use and
 * the first whose key covers the titles of linked documents; version 1 bodies
 * are still readable (ADR-033) but are never served, so a reader that meets
 * one gets a fresh render rather than a body known to be wrong.
 *
 * Version 3 is the first to draw diagrams (Mermaid slots and inline SVG
 * drawings, whose addresses the key covers), badges, figures and cards.
 *
 * Version 4 sets every table in its scroll container, the card the reading
 * stylesheet draws, so the public site and the reader show tables alike.
 *
 * Version 5 draws emoji shortcodes (`:+1:`, and the organisation's own
 * `:acme:`, ADR-038), and leads a label's pill with its emoji.
 *
 * Version 6 sets every table in a block around its scroll container, reads
 * the `:::table` wrapper's options (ADR-040), and marks numeric columns and a
 * stacked table's cell labels; a table may carry a caption, row headers and a
 * footer.
 *
 * Version 7 sets every fenced block in its card, captions a block with the
 * file its `title="…"` names, and draws code groups (ADR-041).
 *
 * Version 8 draws through the installed Markdown extensions (ADR-039): a
 * draw.io diagram at its own size, in light and dark, or as an image of the
 * file when its labels are HTML (ADR-043). The extensions' ids and versions
 * join the key from here on, so upgrading one needs no bump.
 *
 * Version 9 draws details and accordions (ADR-048): `:::details`, GitHub's
 * `<details>`, which was escaped to text before, and Obsidian's foldable
 * callouts, which were quotes.
 *
 * Version 10 draws the navigation blocks (ADR-058): `::toc` as the
 * document's own table of contents, and `::children` as the slot a child
 * pages list is filled into, where both were the live-block fallback before.
 *
 * Version 11 leaves front matter out of the body: the dates it carried were
 * drawn as a list of raw key paths, which the page then read as its eyebrow.
 * What a document states about itself is each surface's byline (ADR-059).
 *
 * Version 12 merges two lines of work that each numbered their own 10 (the
 * other line's 10 named custom emoji by their description). It is above both,
 * so a body cached by either line is never served as current by this one.
 *
 * Version 13 draws a link with a display of its own (ADR-042: the
 * `<!-- quill:link … -->` comment beside it, or the older `:link`/`::link`
 * directives) as the slot its preview is drawn into per reader, where it was
 * the directive's text or the live-block fallback before. Main brought this in
 * at its 10, below this line's 12, so it needs a version above both.
 *
 * Version 14 draws a sourced document's relative links where they resolved
 * (ADR-061): to a document's canonical address and heading, to the forge at
 * the synced commit, or as their words. The resolutions join the key.
 *
 * Version 15 draws a sourced document's relative images from the attachments
 * its repository's assets became, or as their alternative text (ADR-061).
 *
 * Version 16 draws component blocks (ADR-060): the built-in `:::endpoint`,
 * and a container no block or directive claims as a labelled frame naming it,
 * where its wrapper was dropped before. A prop that does not fit is said in
 * the block, and the body reports its blocks' problems (`blockIssues`).
 *
 * Version 17 draws the documentation kit as built-in blocks (`timeline`,
 * `step`, `cast`, `checks` and `route`), where each was a labelled frame or
 * its words; a badge shorthand names itself (`data-badge`) and draws its
 * label as inline Markdown, emoji and all; and an image whose label holds a
 * colon is described by the words written, where a directive took some.
 *
 * Version 18 keeps the detail of a table cell that opens with a status when
 * the detail starts with a link or emphasis, where that first part was dropped.
 *
 * Version 19 hides raw HTML that is only comments, as a block and inline,
 * where it was escaped to text (ADR-011, amendment "HTML comments").
 */
export const RENDER_VERSION = 19

export interface RenderDocumentDependencies {
  readonly uow: UnitOfWork
  readonly contentStore: ContentStore
  readonly format: DocumentFormat
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly hasher: Hasher
  /** Where the SVG drawings a body shows are read from. */
  readonly blobStore: BlobStore
  /** Where the organisation's theme, and so its label names (ADR-037), are read from. */
  readonly settings: Settings
}

export interface RenderDocumentCommand {
  readonly documentId: DocumentId
  /** Defaults to the published head; an older revision renders without touching the link index. */
  readonly revision?: RevisionId | undefined
  /**
   * Whether this render may bring the link index up to date. Defaults to true.
   *
   * False on the public site (ADR-023): an anonymous `GET` should not be able
   * to make the server write, however cheap and however idempotent the write
   * is. The index is maintained by the publish path and by the authenticated
   * reading path, both of which run on every revision, so a public read that
   * declines to touch it never leaves it behind.
   */
  readonly indexLinks?: boolean | undefined
}

export interface RenderedDocument {
  readonly kind: 'rendered'
  readonly revision: RevisionId
  readonly key: string
  readonly content: RenderedContent
  /** True when the entry came from the cache, so the first reader never pays for a render. */
  readonly cached: boolean
}

export type RenderDocumentResult =
  | RenderedDocument
  | { readonly kind: 'unpublished'; readonly documentId: DocumentId }
  | { readonly kind: 'not-found'; readonly documentId: DocumentId }

/**
 * A cached body, whatever version wrote it.
 *
 * Every version ever shipped stays readable (ADR-033); whether a version is
 * still good enough to serve is a separate question, asked below.
 */
const renderedReader = createVersionedReader<RenderedContent>({
  1: readBody,
  2: readBody,
  3: readBody,
})

/**
 * Every shipped version is read the same way, because the shape did not
 * change between them: version 2 says the *renderer* changed, so a version 1
 * entry is readable and simply never served.
 */
function readBody(value: unknown): RenderedContent | null {
  const candidate = value as Partial<RenderedContent>
  return typeof candidate.html === 'string' ? (value as RenderedContent) : null
}

export function renderCacheKey(hash: string, renderVersion: number = RENDER_VERSION): string {
  return `${hash}:${renderVersion}`
}

/**
 * The bytes a render input hashes to.
 *
 * Titles are sorted by document id so the same input always produces the same
 * digest, and the separators cannot occur in a title or a path, so no two
 * different inputs can collide by running their parts together.
 */
export function renderDigest(input: RenderInput, extensions = ''): string {
  const titles = [...input.linkTitles]
    .toSorted(([left], [right]) => (left < right ? -1 : 1))
    .map(([id, title]) => `${id}\u0001${title}`)
    .join('\u0002')
  // A drawing is covered by its address, so replacing the file a URL names
  // is a new key, and the same file under the same URL is the same one.
  const drawings = [...(input.drawings ?? new Map<string, DrawingSource>())]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([url, drawing]) => `${url}\u0001${drawing.sha256}`)
    .join('\u0002')
  const body =
    drawings.length === 0
      ? `${titles}\u0000${input.markdown}`
      : `${titles}\u0000${input.markdown}\u0003${drawings}`
  // Label names only, sorted, and only when there are any, so every body
  // rendered before labels existed keeps its key (ADR-037).
  const labels = [...(input.labels ?? [])].toSorted().join('\u0002')
  const labelled = labels.length === 0 ? body : `${body}\u0004${labels}`
  // Emoji likewise (ADR-038): each custom one by its name and its address,
  // which carries its hash, and each label's leading emoji by name. A
  // monochrome one is marked, and only then, so every other key is unchanged.
  const emoji = [...(input.emoji ?? new Map<string, RenderedEmoji>())]
    .map(
      ([name, image]) =>
        `${name}\u0001${image.src}\u0001${image.width}x${image.height}${image.monochrome === true ? '\u0001glyph' : ''}`,
    )
    .toSorted()
    .join('\u0002')
  const leading = [...(input.labelEmoji ?? new Map<string, string>())]
    .map(([label, name]) => `${label}\u0001${name}`)
    .toSorted()
    .join('\u0002')
  const decorated =
    emoji.length === 0 && leading.length === 0
      ? labelled
      : `${labelled}\u0005${emoji}\u0006${leading}`
  // The installed extensions (ADR-039), only when there are any, so a
  // renderer with none keeps every key it had.
  const extended = extensions === '' ? decorated : `${decorated}\u0007${extensions}`
  // A sourced body's resolved relative links (ADR-061), likewise only when
  // there are any: each destination as written, and where it went.
  const resolved = [...(input.resolvedLinks ?? new Map<string, ResolvedDestination>())]
    .map(([url, to]) => `${url}\u0001${to.kind === 'href' ? to.href : ''}`)
    .toSorted()
    .join('\u0002')
  const linked = resolved.length === 0 ? extended : `${extended}\u0008${resolved}`
  // And its resolved images, likewise.
  const pictured = [...(input.resolvedImages ?? new Map<string, ResolvedDestination>())]
    .map(([url, to]) => `${url}\u0001${to.kind === 'href' ? to.href : ''}`)
    .toSorted()
    .join('\u0002')
  return pictured.length === 0 ? linked : `${linked}\u000e${pictured}`
}

export async function renderDocument(
  deps: RenderDocumentDependencies,
  command: RenderDocumentCommand,
): Promise<RenderDocumentResult> {
  const document = await deps.uow.repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found', documentId: command.documentId }

  const source = await readSource(deps, document.workspaceId, command)
  if (source === null) return { kind: 'unpublished', documentId: command.documentId }

  return renderSource(deps, document, source, command.revision, command.indexLinks ?? true)
}

/**
 * The body for a document whose row and source the caller already holds.
 *
 * The envelope reads both on its way past (ADR-031), and reading the same
 * document three times to answer one request is three times the work for the
 * same answer.
 */
export async function renderSource(
  deps: RenderDocumentDependencies,
  document: DocumentRow,
  source: DocumentSource,
  revision?: RevisionId | undefined,
  indexLinks = true,
): Promise<RenderedDocument> {
  const { repos } = deps.uow
  const { input, linked, hash, key, stored } = await cachedBody(deps, document, source, revision)
  const content = stored ?? deps.format.render(input)
  if (stored === null) {
    await repos.renderCache.save({
      key,
      documentId: document.id,
      contentHash: hash,
      renderVersion: RENDER_VERSION,
      content,
      now: deps.clock.now(),
    })
  }

  // Whether or not the body came from the cache: a restore publishes a body
  // that was rendered before, so a cache hit is exactly when the link index
  // would otherwise be left describing the revision that was undone.
  if (indexLinks) await recordLinks(deps, document, content.links, linked, revision)

  return { kind: 'rendered', revision: source.revision, key, content, cached: stored !== null }
}

/** A body's render input, its cache key, and the cached body when the cache holds a current one. */
async function cachedBody(
  deps: RenderDocumentDependencies,
  document: DocumentRow,
  source: DocumentSource,
  revision: RevisionId | undefined,
) {
  const { input, linked } = await renderInputFor(deps, document, source.markdown, {
    path: source.path,
    revision: source.revision,
    head: revision === undefined,
  })
  const hash = deps.hasher.contentHash(renderDigest(input, deps.format.extensions))
  const key = renderCacheKey(hash)
  const entry = await deps.uow.repos.renderCache.find(key, deps.clock.now())
  const read = entry === null ? null : renderedReader.read(entry.content)
  const stored = read !== null && read.version === RENDERED_CONTENT_VERSION ? read : null
  return { input, linked, hash, key, stored }
}

/**
 * Renders the published heads of these documents ahead of their first
 * reader, many at once (ADR-062, step 3), and keeps each body in the render
 * cache under exactly the key `renderSource` would compute for it, so the
 * reader's render, and the outbox's, find it there. A body already cached
 * is not rendered again. What the render reads (the store, titles,
 * drawings, settings) is read here as `renderSource` reads it; only the
 * rendering itself is handed to `work`, which may spread it over threads.
 * Nothing about a document changes but its cached body.
 */
export async function warmRenderedBodies(
  deps: RenderDocumentDependencies & { readonly work: DocumentWork },
  documentIds: readonly DocumentId[],
): Promise<number> {
  const rows = await deps.uow.repos.documents.listByIds([...documentIds])
  const misses: {
    readonly document: DocumentRow
    readonly input: RenderInput
    readonly hash: string
    readonly key: string
  }[] = []
  // oxlint-disable-next-line quill/no-independent-await-in-loop -- one document's reads at a time, as a reader's render reads them
  for (const document of rows) {
    if (document.headRevision === null) continue
    const source = await readSource(deps, document.workspaceId, { documentId: document.id })
    /* v8 ignore next -- a document with a head revision is stored at it. */
    if (source === null) continue
    const { input, hash, key, stored } = await cachedBody(deps, document, source, undefined)
    if (stored === null) misses.push({ document, input, hash, key })
  }
  if (misses.length === 0) return 0
  const contents = await deps.work.render(misses.map(({ input }) => input))
  const now = deps.clock.now()
  // oxlint-disable-next-line quill/no-independent-await-in-loop -- one transaction's client writes one row at a time
  for (const [index, { document, hash, key }] of misses.entries()) {
    const content = contents[index]
    /* v8 ignore next -- a render answers every input it is given. */
    if (content === undefined) throw new Error(`No body rendered for ${document.id}.`)
    await deps.uow.repos.renderCache.save({
      key,
      documentId: document.id,
      contentHash: hash,
      renderVersion: RENDER_VERSION,
      content,
      now,
    })
  }
  return misses.length
}

/** A render input whose drawings are known, though there may be none: what `renderInputFor` always answers. */
export type DrawnRenderInput = RenderInput & {
  readonly drawings: ReadonlyMap<string, DrawingSource>
}

/**
 * Everything a body is rendered from (ADR-031): its Markdown, the titles of
 * the documents it links to, the drawings it shows, and the organisation's
 * labels and emoji. A comparison is drawn from the same inputs as a body,
 * which is why this is shared rather than repeated (`compare-revisions.ts`).
 *
 * A published document's place — its path in the revision being rendered —
 * is given when there is one, so a sourced document's relative links are
 * resolved against that revision (ADR-061); a draft and a comparison have
 * none and draw those links as written.
 */
export async function renderInputFor(
  deps: Pick<RenderDocumentDependencies, 'uow' | 'blobStore' | 'settings' | 'contentStore'>,
  document: DocumentRow,
  markdown: string,
  place?: SourcePlace,
): Promise<{
  readonly input: DrawnRenderInput
  readonly linked: ReadonlyMap<DocumentId, DocumentRow>
}> {
  const [named, vocabulary, sourced] = await Promise.all([
    linkedDocuments(deps.uow.repos.documents, markdown),
    organisationVocabulary(deps.settings),
    place === undefined ? null : sourceLinksAt(deps, document, markdown, place),
  ])
  const [linked, drawings] = await Promise.all([
    withTargets(deps.uow.repos.documents, named, sourced?.targets),
    drawingsShown(deps, document, markdown, sourced?.attachments),
  ])
  return {
    input: assembleRenderInput({
      markdown,
      linkTitles: new Map([...linked].map(([id, row]) => [id, row.title])),
      drawings,
      vocabulary,
      sourced,
    }),
    linked,
  }
}

/**
 * A render input from its parts, in the one shape every body is keyed by
 * (ADR-031). A sourced document's resolved links and images join it only
 * when it has some, so a body without any keeps the key it always had. The
 * reader's render and the head plan of a source (ADR-062) both assemble it
 * here.
 */
export function assembleRenderInput(parts: {
  readonly markdown: string
  readonly linkTitles: ReadonlyMap<DocumentId, string>
  readonly drawings: ReadonlyMap<string, DrawingSource>
  readonly vocabulary: Pick<RenderInput, 'labels' | 'emoji' | 'labelEmoji'>
  readonly sourced: Pick<SourceLinks, 'resolved' | 'images'> | null
}): DrawnRenderInput {
  const { markdown, linkTitles, drawings, vocabulary, sourced } = parts
  return {
    markdown,
    linkTitles,
    drawings,
    ...vocabulary,
    ...(sourced === null || sourced.resolved.size === 0 ? {} : { resolvedLinks: sourced.resolved }),
    ...(sourced === null || sourced.images.size === 0 ? {} : { resolvedImages: sourced.images }),
  }
}

/**
 * The documents a body names, with those its relative links resolved to
 * (ADR-061): their titles are part of the input like any linked document's,
 * and the link index classifies a resolved link by them.
 */
async function withTargets(
  documents: DocumentRepository,
  named: ReadonlyMap<DocumentId, DocumentRow>,
  targets: ReadonlySet<DocumentId> | undefined,
): Promise<ReadonlyMap<DocumentId, DocumentRow>> {
  const missing = [...(targets ?? [])].filter((id) => !named.has(id))
  if (missing.length === 0) return named
  const rows = await documents.listByIds(missing)
  return new Map([...named, ...rows.map((row) => [row.id, row] as const)])
}

/**
 * The documents a body links to, by id, in two queries at most.
 *
 * A link is canonically a `/d/<uuid>` URL, but a body published before the
 * canonicalisation ran — or one whose key named nothing at the time — may
 * still carry the readable form, and its backlinks have to work too
 * (ADR-035). Each shape costs one query for the whole body, never one per
 * link.
 */
async function linkedDocuments(
  documents: DocumentRepository,
  markdown: string,
): Promise<ReadonlyMap<DocumentId, DocumentRow>> {
  const references = [...linkedDocumentReferences(markdown)]
  if (references.length === 0) return new Map()

  const ids = references.flatMap((reference) =>
    reference.kind === 'uuid' ? [reference.documentId] : [],
  )
  const keys = references.flatMap((reference) =>
    reference.kind === 'short-id' ? [reference.shortId] : [],
  )
  const [byId, byKey] = await Promise.all([
    ids.length === 0 ? [] : documents.listByIds(ids),
    keys.length === 0 ? [] : documents.listByShortIds(keys),
  ])
  return new Map([...byId, ...byKey].map((row) => [row.id, row]))
}

/**
 * The organisation's label names (ADR-037) and its emoji (ADR-038), from its
 * settings.
 *
 * Organisation-wide, so a name means the same in every workspace and on the
 * public site. Settings nobody saved are the defaults, which have neither;
 * a settings file this release cannot read leaves a body's labels and emoji
 * as the literal text they degrade to, rather than taking the document down
 * with it — the settings screens are where that file is reported and repaired.
 */
export async function organisationVocabulary(
  settings: Settings,
): Promise<Pick<RenderInput, 'labels' | 'emoji' | 'labelEmoji'>> {
  const read = await settings.readOrganisation()
  if (read.kind !== 'settings') return { labels: new Set() }
  const { theme, emoji } = read.document
  return {
    labels: new Set((theme.labels ?? []).map((label) => label.name)),
    emoji: customEmojiByName(emoji),
    labelEmoji: labelEmoji(theme, emoji),
  }
}

/** Larger than any drawing a person makes; a file past it is shown as a link, not drawn. */
export const MAX_DRAWING_BYTES = 1024 * 1024

/**
 * The SVG drawings a body shows, read once per render.
 *
 * Only this document's own workspace is asked, in one query, so a body can
 * never draw another workspace's file whatever URL it names; a removed file
 * and one too large to be a drawing are left out, and the body shows them as
 * it would any image it cannot draw. The bytes are read in parallel: there are
 * a handful at most, and each is small.
 */
async function drawingsShown(
  deps: Pick<RenderDocumentDependencies, 'uow' | 'blobStore'>,
  document: DocumentRow,
  markdown: string,
  imported: ReadonlySet<string> = new Set(),
): Promise<ReadonlyMap<string, DrawingSource>> {
  // A sourced body's images name their attachments only once resolved (ADR-061).
  const ids = [...new Set([...attachmentIdsIn(markdown), ...imported])]
  if (ids.length === 0) return new Map()
  const rows = await deps.uow.repos.attachments.listLiveInWorkspace(document.workspaceId, ids)
  return await drawingSources(deps.blobStore, rows)
}

/**
 * The drawings among these attachments, by the address a body shows them
 * at: each SVG drawing small enough to draw, read from the blob store. A
 * file the store no longer holds is left out, and shown as an image.
 */
export async function drawingSources(
  blobStore: BlobStore,
  attachments: Iterable<{
    readonly id: AttachmentId
    readonly contentType: string
    readonly size: number
    readonly sha256: string
  }>,
): Promise<ReadonlyMap<string, DrawingSource>> {
  const drawable = [...attachments].filter(
    (row) => row.contentType === DRAWING_MEDIA_TYPE && row.size <= MAX_DRAWING_BYTES,
  )
  const read = await Promise.all(
    drawable.map(async (row) => {
      const bytes = await readBlob(blobStore, row.sha256)
      if (bytes === null) return []
      const markup = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      return [[attachmentUrl(row.id), { sha256: row.sha256, markup }] as const]
    }),
  )
  return new Map(read.flat())
}

/**
 * Records what this document points at.
 *
 * Only the published head's links are indexed: rendering an older revision is
 * a historical view and must not rewrite what the document links to today.
 * The rows are replaced only when they would change, so serving a cached body
 * stays a read.
 */
async function recordLinks(
  deps: RenderDocumentDependencies,
  document: DocumentRow,
  links: readonly ExtractedLink[],
  linked: ReadonlyMap<DocumentId, DocumentRow>,
  revision: RevisionId | undefined,
): Promise<void> {
  if (revision !== undefined && revision !== document.headRevision) return
  const { documentLinks } = deps.uow.repos
  const resolved = resolveLinks(links, linked)
  const current = await documentLinks.listForDocument(document.id)
  if (sameLinks(current, resolved)) return
  await documentLinks.replaceForDocument({
    documentId: document.id,
    links: resolved,
    idFor: () => deps.ids.uuid(),
  })
}

function sameLinks(
  current: readonly DocumentLinkRow[],
  resolved: readonly NewDocumentLink[],
): boolean {
  return (
    current.length === resolved.length &&
    current.every((row, index) => {
      const link = resolved[index]
      return (
        link !== undefined &&
        row.url === link.url &&
        row.text === link.text &&
        row.kind === link.kind &&
        row.targetDocumentId === link.targetDocumentId
      )
    })
  )
}

/**
 * Classifies a body's links and resolves the ones that name a document.
 *
 * Links to other documents are canonical id URLs (ADR-031), so a target that
 * no longer exists is a broken link — a health signal, never an error — and
 * the documents are the ones already loaded for their titles, so however many
 * links a body carries this costs no query of its own.
 */
export function resolveLinks(
  links: readonly ExtractedLink[],
  linked: ReadonlyMap<DocumentId, DocumentRow>,
): readonly NewDocumentLink[] {
  // Keyed once for the whole body rather than searched per link: the
  // documents are the ones already loaded for their titles, so however many
  // links a body carries this costs no query and no scan of its own.
  const byShortId = new Map([...linked.values()].map((row) => [row.shortId, row.id]))
  return links.map((link) => ({
    url: link.url,
    text: link.text,
    ...classify(link, linked, byShortId),
  }))
}

function classify(
  link: ExtractedLink,
  linked: ReadonlyMap<DocumentId, DocumentRow>,
  byShortId: ReadonlyMap<ShortId, DocumentId>,
): { readonly kind: NewDocumentLink['kind']; readonly targetDocumentId: DocumentId | null } {
  const reference = documentReferenceFromUrl(link.url)
  if (reference === null) {
    return { kind: link.external ? 'external' : 'internal', targetDocumentId: null }
  }
  const target =
    reference.kind === 'uuid' ? reference.documentId : (byShortId.get(reference.shortId) ?? null)
  return {
    kind: 'document',
    targetDocumentId: target !== null && linked.has(target) ? target : null,
  }
}
