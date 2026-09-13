import { isShortId, isUuid, shortId, slugify } from '@quill/domain'
import type { DocumentId, ShortId, WorkspaceId } from '@quill/domain'

import type { DocumentRow } from '../ports/persistence.ts'

/**
 * Where a document lives in the content store.
 *
 * Documents are addressed by id and never by path (decision D17), so a path
 * exists for one reason: a clone of the repository should read as the tree a
 * person would have written by hand (ADR-014). It is derived from the
 * collection and the titles above the document, and it is unique within a
 * workspace because the store is a filesystem tree.
 */

const MARKDOWN_SUFFIX = '.md'

/**
 * The word a thing with no usable title falls back to.
 *
 * `slugify` answers with an empty string when a title is nothing but symbols
 * (ADR-035), because a URL simply leaves the words out; a path segment and a
 * workspace slug have to be *called* something, so they come through here.
 */
export const UNTITLED_SLUG = 'untitled'

export function namedSlug(value: string): string {
  const slug = slugify(value)
  return slug.length === 0 ? UNTITLED_SLUG : slug
}

/** Slug construction lives in the domain (ADR-035); this re-export keeps one import for callers. */
export { slugify }

export interface DocumentPlacement {
  readonly workspaceId: WorkspaceId
  readonly collectionSlug: string
  readonly parent: DocumentRow | null
  readonly slug: string
}

/**
 * The path a document takes, given where it sits.
 *
 * A document with children is `index.md` inside its own directory (ADR-014),
 * so a child's path is built from its parent's directory rather than from the
 * parent's file name.
 */
export function documentPath(placement: DocumentPlacement): string {
  const parentDirectory =
    placement.parent === null ? placement.collectionSlug : directoryOf(placement.parent.path)
  return `${parentDirectory}/${placement.slug}${MARKDOWN_SUFFIX}`
}

/** The directory a nested document's children belong in. */
export function directoryOf(path: string): string {
  return path.endsWith(MARKDOWN_SUFFIX) ? path.slice(0, -MARKDOWN_SUFFIX.length) : path
}

/**
 * How many paths one title may try before the platform gives up.
 *
 * The bound matters: without it a workspace that somehow cannot accept a path
 * — a repository the creator has no rights in, a family of titles that all
 * slugify to the same word — spins for ever inside a transaction rather than
 * answering.
 */
export const MAX_PATH_ATTEMPTS = 50

export interface PathCandidate {
  readonly slug: string
  readonly path: string
}

/**
 * The paths this placement may take, in order of preference.
 *
 * Two documents may legitimately be given the same title, and a workspace
 * stores one file per document, so the second one takes `-2`. Which candidate
 * a document ends up with is decided by claiming it behind the unique
 * `(workspace_id, path)` index rather than by probing first and inserting
 * afterwards, so this is a pure sequence and the database settles the race.
 */
export function* documentPathCandidates(
  placement: DocumentPlacement,
  limit: number = MAX_PATH_ATTEMPTS,
): Generator<PathCandidate> {
  for (let attempt = 1; attempt <= limit; attempt++) {
    const slug = attempt === 1 ? placement.slug : `${placement.slug}-${attempt}`
    yield { slug, path: documentPath({ ...placement, slug }) }
  }
}

/** The canonical, path-free URL of a document (ADR-031). */
export function documentUrl(id: DocumentId): string {
  return `/d/${id}`
}

/**
 * What a document reference in a URL resolves to (ADR-035).
 *
 * A reference is the words and the key (`authentication-architecture-k7m3q9v2xd`),
 * the key alone, or the UUID the platform has always accepted. The words are
 * advisory: they are never consulted, so a stale title in a link resolves to
 * the document anyway and the caller corrects the address.
 */
export type DocumentReference =
  | { readonly kind: 'short-id'; readonly shortId: ShortId }
  | { readonly kind: 'uuid'; readonly documentId: DocumentId }

/**
 * The reference in a URL, or null when it is not one.
 *
 * Split on the last hyphen: if the tail is a key, that is the reference, and
 * whatever came before it was the words. Otherwise the whole reference has to
 * be a UUID, which is the form every link written before ADR-035 carries and
 * which resolves for ever (ADR-033).
 */
export function parseDocumentReference(reference: string): DocumentReference | null {
  const tail = reference.slice(reference.lastIndexOf('-') + 1)
  if (isShortId(tail)) return { kind: 'short-id', shortId: shortId(tail) }
  if (isUuid(reference)) return { kind: 'uuid', documentId: reference.toLowerCase() as DocumentId }
  return null
}

/** The reference a link to this document should carry: the words, then the key. */
export function documentReference(document: {
  readonly title: string
  readonly shortId: ShortId
}): string {
  const slug = slugify(document.title)
  return slug.length === 0 ? document.shortId : `${slug}-${document.shortId}`
}

/**
 * A reference may carry letters of any script, percent-encoded by the browser,
 * and ends before the first character a URL or a Markdown link can delimit it
 * with.
 */
const REFERENCE = String.raw`[\p{Letter}\p{Number}%_-]+`
const DOCUMENT_LINK_URL = new RegExp(
  String.raw`^(?:/w/${REFERENCE})?/d/(${REFERENCE})(?:[#?/].*)?$`,
  'u',
)
const DOCUMENT_LINK_ANYWHERE = new RegExp(String.raw`/d/(${REFERENCE})`, 'gu')
const WORKSPACE_DOCUMENT_LINK = new RegExp(String.raw`/w/${REFERENCE}/d/(${REFERENCE})`, 'gu')

/** The document a link URL names, in any form it may have been written in. */
export function documentReferenceFromUrl(url: string): DocumentReference | null {
  const [, reference] = DOCUMENT_LINK_URL.exec(url) ?? []
  return reference === undefined ? null : parseDocumentReference(reference)
}

/** The document a canonical id URL points at, or null when the URL is not one. */
export function documentIdFromUrl(url: string): DocumentId | null {
  const reference = documentReferenceFromUrl(url)
  return reference?.kind === 'uuid' ? reference.documentId : null
}

/**
 * Every document a piece of Markdown names, without parsing it.
 *
 * A link to another document is canonically an id URL (ADR-031), but a reader
 * may have pasted the readable form out of the address bar before the publish
 * path rewrote it, so both are recognised. A URL is written literally in the
 * source, so scanning for the shape finds each one in a single pass — which is
 * what lets the titles those documents carry be resolved *before* the render
 * that needs them. The scan is deliberately generous: a reference inside a
 * code fence names a document that is not really linked, which costs one entry
 * in a title map and never a wrong body.
 */
export function* linkedDocumentReferences(markdown: string): Generator<DocumentReference> {
  const seen = new Set<string>()
  for (const [, text] of markdown.matchAll(DOCUMENT_LINK_ANYWHERE)) {
    /* v8 ignore next -- the capture group is mandatory, so a match always has it. */
    const reference = parseDocumentReference(text ?? '')
    if (reference === null) continue
    const key = reference.kind === 'uuid' ? reference.documentId : reference.shortId
    if (seen.has(key)) continue
    seen.add(key)
    yield reference
  }
}

/** The ids of the documents a body names by UUID. */
export function* linkedDocumentIds(markdown: string): Generator<DocumentId> {
  for (const reference of linkedDocumentReferences(markdown)) {
    if (reference.kind === 'uuid') yield reference.documentId
  }
}

/**
 * Every reference an author pasted out of the address bar (`/w/<ws>/d/<ref>`).
 *
 * These are the links a publish rewrites into the canonical form, so the link
 * index and backlinks see the same shape however the link was written
 * (ADR-035).
 */
export function* workspaceLinkReferences(markdown: string): Generator<string> {
  const seen = new Set<string>()
  for (const [, reference] of markdown.matchAll(WORKSPACE_DOCUMENT_LINK)) {
    /* v8 ignore next -- the capture group is mandatory, so a match always has it. */
    const text = reference ?? ''
    if (seen.has(text)) continue
    seen.add(text)
    yield text
  }
}

/**
 * Rewrites the readable links in a body to the canonical `/d/<uuid>` form.
 *
 * Pure, and driven by a map the caller resolved in one query: a reference the
 * map does not name is left exactly as it was, so a key that names nothing
 * stays a broken link the health signal can report rather than becoming a
 * silently different one (ADR-035).
 */
export function canonicaliseDocumentLinks(
  markdown: string,
  documentIds: ReadonlyMap<string, DocumentId>,
): string {
  return markdown.replaceAll(WORKSPACE_DOCUMENT_LINK, (match, reference: string) => {
    const id = documentIds.get(reference)
    return id === undefined ? match : documentUrl(id)
  })
}
