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
} from '../ports/document-format.ts'
import { RENDERED_CONTENT_VERSION } from '../ports/document-format.ts'
import type {
  DocumentLinkRow,
  DocumentRepository,
  DocumentRow,
  NewDocumentLink,
  UnitOfWork,
} from '../ports/persistence.ts'
import type { Settings } from '../ports/settings.ts'
import type { RenderedEmoji } from '../settings/emoji.ts'
import { customEmojiByName, labelEmoji } from '../settings/emoji.ts'
import type { Clock, Hasher, IdGenerator } from '../ports/system.ts'
import { documentReferenceFromUrl, linkedDocumentReferences } from './document-path.ts'
import { attachmentIdsIn, attachmentUrl } from './attachments.ts'
import { DRAWING_MEDIA_TYPE } from './media-types.ts'
import { readSource } from './read-published.ts'
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
 */
export const RENDER_VERSION = 13

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
  // which carries its hash, and each label's leading emoji by name.
  const emoji = [...(input.emoji ?? new Map<string, RenderedEmoji>())]
    .map(([name, image]) => `${name}\u0001${image.src}\u0001${image.width}x${image.height}`)
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
  return extensions === '' ? decorated : `${decorated}\u0007${extensions}`
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
  const { input, linked } = await renderInputFor(deps, document, source.markdown)

  const now = deps.clock.now()
  const hash = deps.hasher.contentHash(renderDigest(input, deps.format.extensions))
  const key = renderCacheKey(hash)
  const entry = await repos.renderCache.find(key, now)
  const stored = entry === null ? null : renderedReader.read(entry.content)
  const usable = stored !== null && stored.version === RENDERED_CONTENT_VERSION

  const content = usable ? stored : deps.format.render(input)
  if (!usable) {
    await repos.renderCache.save({
      key,
      documentId: document.id,
      contentHash: hash,
      renderVersion: RENDER_VERSION,
      content,
      now,
    })
  }

  // Whether or not the body came from the cache: a restore publishes a body
  // that was rendered before, so a cache hit is exactly when the link index
  // would otherwise be left describing the revision that was undone.
  if (indexLinks) await recordLinks(deps, document, content.links, linked, revision)

  return { kind: 'rendered', revision: source.revision, key, content, cached: usable }
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
 */
export async function renderInputFor(
  deps: Pick<RenderDocumentDependencies, 'uow' | 'blobStore' | 'settings'>,
  document: DocumentRow,
  markdown: string,
): Promise<{
  readonly input: DrawnRenderInput
  readonly linked: ReadonlyMap<DocumentId, DocumentRow>
}> {
  const [linked, drawings, vocabulary] = await Promise.all([
    linkedDocuments(deps.uow.repos.documents, markdown),
    drawingsShown(deps, document, markdown),
    organisationVocabulary(deps.settings),
  ])
  return {
    input: {
      markdown,
      linkTitles: new Map([...linked].map(([id, row]) => [id, row.title])),
      drawings,
      ...vocabulary,
    },
    linked,
  }
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
async function organisationVocabulary(
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
): Promise<ReadonlyMap<string, DrawingSource>> {
  const ids = attachmentIdsIn(markdown)
  if (ids.length === 0) return new Map()
  const rows = await deps.uow.repos.attachments.listLiveInWorkspace(document.workspaceId, ids)
  const drawable = rows.filter(
    (row) => row.contentType === DRAWING_MEDIA_TYPE && row.size <= MAX_DRAWING_BYTES,
  )
  const read = await Promise.all(
    drawable.map(async (row) => {
      const bytes = await readBlob(deps.blobStore, row.sha256)
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
