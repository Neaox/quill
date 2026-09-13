import type { LinkTarget } from '@quill/ui'

import { slugify } from '../documents/slugify.ts'

/**
 * How a document is addressed in the application's URLs (ADR-035).
 *
 * A reference is `<title-slug>-<key>`, where the key is the document's short
 * id — ten lower-case Crockford base-32 characters, stable for the life of the
 * document — and the slug is advisory: derived from the current title, never
 * stored as identity, and free to be stale. Only the key decides, which is why
 * a rename can never break a link (AGENTS.md rule 8) while the address still
 * says what it points at.
 *
 * A bare UUID keeps resolving for ever (ADR-033): every link that exists today
 * is one, and the route canonicalises it rather than refusing it.
 *
 * This module is also where the two route patterns an address is made of live
 * (`workspaceLink`, `documentLink`), so nothing in the application concatenates
 * a URL: a link is a route and its parameters, and the router encodes it.
 */

/**
 * Crockford base-32 without the letters that read as digits (i, l, o, u), ten
 * characters. Lower-case: an address is typed and read aloud.
 */
const SHORT_KEY = /^[0-9abcdefghjkmnpqrstvwxyz]{10}$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DocumentReference =
  /** The tail of the reference is a short key; the slug (possibly empty) is advisory. */
  | { readonly kind: 'key'; readonly key: string; readonly slug: string }
  /** The whole reference is a document's UUID: an old link, still good. */
  | { readonly kind: 'id'; readonly id: string }
  /** Neither: nothing can be resolved from it. */
  | { readonly kind: 'unknown' }

/**
 * Reads a URL's document reference.
 *
 * The split is on the **last** hyphen, so a title full of hyphens is not a
 * problem: the key is always the final segment, and a tail that is not a valid
 * key means the whole reference has to stand on its own as a UUID.
 */
export function parseDocumentReference(reference: string): DocumentReference {
  if (SHORT_KEY.test(reference)) return { kind: 'key', key: reference, slug: '' }

  const separator = reference.lastIndexOf('-')
  if (separator > 0) {
    const tail = reference.slice(separator + 1)
    if (SHORT_KEY.test(tail)) {
      return { kind: 'key', key: tail, slug: reference.slice(0, separator) }
    }
  }

  if (UUID.test(reference)) return { kind: 'id', id: reference }
  return { kind: 'unknown' }
}

/** What the API should be asked for, given a reference the router matched. */
export function documentIdFromReference(reference: DocumentReference): string | undefined {
  switch (reference.kind) {
    case 'key':
      return reference.key
    case 'id':
      return reference.id
    case 'unknown':
      return undefined
  }
}

/**
 * The fields a reference is built from. Every document the API answers with
 * carries a `shortId` (ADR-035), so there is no fallback to the UUID here: a
 * caller that cannot supply one does not hold a document.
 */
export interface ReferencableDocument {
  readonly id: string
  readonly title: string
  readonly shortId: string
}

/** The fields a workspace address is built from. */
export interface ReferencableWorkspace {
  readonly id: string
  readonly slug: string
}

/**
 * A workspace's own address: its slug, which is unique across the instance and
 * which `GET /api/workspaces/{idOrSlug}` accepts alongside the id (ADR-035).
 */
export function workspaceReference(workspace: ReferencableWorkspace): string {
  return workspace.slug
}

/**
 * The canonical reference for a document: its current title's slug and its
 * key. A title that slugifies to nothing — one made only of symbols — gives
 * the bare key, because a leading hyphen would be noise rather than a word.
 */
export function documentReference(document: ReferencableDocument): string {
  const slug = slugify(document.title)
  return slug === '' ? document.shortId : `${slug}-${document.shortId}`
}

/**
 * Where a workspace's own home is, as the router describes a place: the route
 * pattern and the value its one segment takes. Never an interpolated string —
 * the router type-checks the pattern against the real route tree and encodes
 * the segment (ADR-035, "link generation goes through one helper").
 *
 * `workspaceSlug` is the segment a caller already holds: what
 * `workspaceReference()` produced, or the one the router matched.
 */
export function workspaceLink(workspaceSlug: string): LinkTarget {
  return { to: '/w/$workspaceSlug', params: { workspaceSlug } }
}

/**
 * The search results route, spelled the same way: a pattern, its one segment,
 * and the query as a search param rather than a string anybody assembled
 * (ADR-013 — the query is URL state, so it is linkable and shareable).
 */
export type SearchLinkTarget = {
  readonly to: '/w/$workspaceSlug/search'
  readonly params: { readonly workspaceSlug: string }
  readonly search: { readonly q: string }
}

/** Where a workspace's full search results are, for a given query. */
export function searchLink(workspaceSlug: string, query: string): SearchLinkTarget {
  return { to: '/w/$workspaceSlug/search', params: { workspaceSlug }, search: { q: query } }
}

/** The search params a reading link may carry (`routes/.../$documentId/index.tsx`). */
export interface DocumentLinkSearch {
  /** A revision to read instead of the head. */
  readonly rev?: string | undefined
}

/**
 * The reading route, spelled precisely enough for `navigate()` as well as for
 * a `LinkTarget`: no `hash`, and a `search` shape the route's own validator
 * agrees with.
 */
export type DocumentLinkTarget = {
  readonly to: '/w/$workspaceSlug/d/$documentId'
  readonly params: { readonly workspaceSlug: string; readonly documentId: string }
  readonly search: { readonly rev?: string }
}

/**
 * Where a document is read. `documentId` is the reference — what
 * `documentReference()` produced, or the segment the router matched.
 */
export function documentLink(
  workspaceSlug: string,
  documentId: string,
  search: DocumentLinkSearch = {},
): DocumentLinkTarget {
  return {
    to: '/w/$workspaceSlug/d/$documentId',
    params: { workspaceSlug, documentId },
    search: search.rev === undefined ? {} : { rev: search.rev },
  }
}

/**
 * Where the target of a share link is read: the token, and nothing else.
 *
 * The token *is* the capability, so it is the only segment the address needs,
 * and neither of the two share addresses carries a workspace or a collection
 * — a reader holding a link can reach exactly what it opens and nothing
 * around it (`docs/product/surfaces.md`).
 */
export type ShareLinkTargetTarget = {
  readonly to: '/share/$token'
  readonly params: { readonly token: string }
}

export function shareLinkTargetLink(token: string): ShareLinkTargetTarget {
  return { to: '/share/$token', params: { token } }
}

/**
 * Where a document *inside* a subtree share link is read.
 *
 * The reference is built the same way every other address is — the current
 * title's slug and the document's short key (ADR-035) — so a shared page
 * reads like an internal one and the API resolves it by the same rule. It is
 * spelled here rather than concatenated at the call site for the reason the
 * rest of this module exists: a link is a route and its parameters, and the
 * router encodes it.
 */
export type SharedDocumentLinkTarget = {
  readonly to: '/share/$token/d/$documentRef'
  readonly params: { readonly token: string; readonly documentRef: string }
}

export function sharedDocumentLink(
  token: string,
  document: ReferencableDocument,
): SharedDocumentLinkTarget {
  return {
    to: '/share/$token/d/$documentRef',
    params: { token, documentRef: documentReference(document) },
  }
}
