/**
 * Branded identifier types.
 *
 * Every entity is addressed by a stable UUID that never changes across rename,
 * move, or Git sync (decision D17). Branding stops a WorkspaceId being passed
 * where a DocumentId is expected, at zero runtime cost.
 */

import { canonicalShortId, SHORT_ID_LENGTH } from './short-id.ts'

declare const brand: unique symbol

type Branded<T, Name extends string> = T & { readonly [brand]: Name }

/** The deployment itself, and the root of the organisational unit tree. */
export type InstanceId = Branded<string, 'InstanceId'>

/** A node in the organisational unit tree: a company, department, or team. */
export type UnitId = Branded<string, 'UnitId'>

/**
 * A document's short public handle (ADR-035): ten Crockford base-32
 * characters, unique across the instance, assigned at creation and never
 * changed. The UUID stays the primary key and the canonical identifier; this
 * is a second, equally stable handle that fits in a link somebody reads.
 */
export type ShortId = Branded<string, 'ShortId'>

export type WorkspaceId = Branded<string, 'WorkspaceId'>
export type CollectionId = Branded<string, 'CollectionId'>
export type DocumentId = Branded<string, 'DocumentId'>
export type GroupId = Branded<string, 'GroupId'>
export type UserId = Branded<string, 'UserId'>
export type ShareLinkId = Branded<string, 'ShareLinkId'>

/** A content-store revision identifier (a 40-character SHA-1 hex string). */
export type RevisionId = Branded<string, 'RevisionId'>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA1_PATTERN = /^[0-9a-f]{40}$/

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/**
 * Builds the parser for one kind of id.
 *
 * Every kind shares this implementation so a new entity costs one line and its
 * validation cannot drift from the rest.
 */
function uuidParser<Name extends string>(kind: Name): (value: string) => Branded<string, Name> {
  return (value) => {
    if (!isUuid(value)) {
      throw new TypeError(`Invalid ${kind}: expected a UUID, received "${value}"`)
    }
    return value.toLowerCase() as Branded<string, Name>
  }
}

export const instanceId = uuidParser('InstanceId')
export const unitId = uuidParser('UnitId')
export const workspaceId = uuidParser('WorkspaceId')
export const collectionId = uuidParser('CollectionId')
export const documentId = uuidParser('DocumentId')
export const groupId = uuidParser('GroupId')
export const userId = uuidParser('UserId')
export const shareLinkId = uuidParser('ShareLinkId')

/** Whether this is a short key, in any form a person might have typed it. */
export function isShortId(value: string): boolean {
  return canonicalShortId(value) !== null
}

/**
 * The key a caller presented, in canonical form.
 *
 * Parsing normalises rather than rejects the confusable forms (`canonicalShortId`),
 * so a key copied out of a printed page resolves to the document it names.
 */
export function shortId(value: string): ShortId {
  const canonical = canonicalShortId(value)
  if (canonical === null) {
    throw new TypeError(
      `Invalid ShortId: expected ${SHORT_ID_LENGTH} Crockford base-32 characters, received "${value}"`,
    )
  }
  return canonical as ShortId
}

export function revisionId(value: string): RevisionId {
  if (!SHA1_PATTERN.test(value)) {
    throw new TypeError(
      `Invalid RevisionId: expected a 40-character hex string, received "${value}"`,
    )
  }
  return value as RevisionId
}
