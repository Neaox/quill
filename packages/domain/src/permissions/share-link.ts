import type { DocumentId, ShareLinkId, UserId } from '../ids.ts'
import type { Role } from '../roles.ts'
import type { Grant } from './grant.ts'
import { shareLinkPrincipal } from './principal.ts'
import type { ScopeChain } from './scope-chain.ts'
import { documentScope, scopeKey } from './scope.ts'

/**
 * A share link: a capability URL mapped to a grant (plan section 14).
 *
 * The link is a principal like any other (ADR-012), so a reader who followed
 * one travels the same resolution path as a member and there is no second,
 * weaker code path to get wrong. What is particular to a link is the *shape*
 * of what it reaches — one document, or that document and everything nested
 * under it — and that is what this module states, as pure functions over a
 * scope chain.
 *
 * The token itself is not here. Only its SHA-256 hash is ever stored, and
 * nothing in resolution needs either: by the time a link is a `ShareLink` the
 * token has already been matched, and carrying a credential through the
 * permission model would only give it more places to leak from.
 */

/** This document, or this document and everything nested under it. */
export const SHARE_LINK_SCOPES = ['document', 'subtree'] as const

export type ShareLinkScope = (typeof SHARE_LINK_SCOPES)[number]

export function isShareLinkScope(value: string): value is ShareLinkScope {
  return SHARE_LINK_SCOPES.some((scope) => scope === value)
}

/**
 * The roles a link may carry today.
 *
 * View is the whole of the first release; comment and edit arrive with M7
 * (plan section 14, use case 24). The list exists so that widening it is one
 * edit here rather than a search for every place a role was assumed.
 */
export const SHARE_LINK_ROLES = ['viewer'] as const

export type ShareLinkRole = (typeof SHARE_LINK_ROLES)[number]

export function isShareLinkRole(value: Role): value is ShareLinkRole {
  return SHARE_LINK_ROLES.some((role) => role === value)
}

export interface ShareLink {
  readonly id: ShareLinkId

  /** The document the link is about: its target, and the root of its subtree. */
  readonly documentId: DocumentId
  readonly scope: ShareLinkScope
  readonly role: Role

  /** Null for a link that never expires. */
  readonly expiresAt: Date | null
  readonly revokedAt: Date | null
  readonly createdBy: UserId
}

/**
 * Why a link does not work, or that it does.
 *
 * Revocation is checked before expiry so that a link revoked and then left to
 * expire still reports the deliberate act rather than the passage of time;
 * only the audit log and an administrator's list ever see the difference,
 * because every refusal answers a reader identically (ADR-011: no
 * enumeration).
 */
export type ShareLinkState = 'valid' | 'revoked' | 'expired'

export function shareLinkState(link: ShareLink, now: Date): ShareLinkState {
  if (link.revokedAt !== null) return 'revoked'
  // An expiry is the instant the link stops working, so the comparison is
  // not strict: a link expiring at noon is already gone at noon.
  if (link.expiresAt !== null && link.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'valid'
}

/**
 * Whether the link reaches the document this chain governs.
 *
 * A chain is ordered from the document itself outwards (`buildScopeChain`), so
 * a document-scoped link asks whether the chain *starts* at its target, and a
 * subtree-scoped link asks whether its target appears anywhere along the
 * document half of the chain — which is exactly the set of documents nested
 * under it, since a chain carries one scope per ancestor document.
 */
export function shareLinkCovers(link: ShareLink, chain: ScopeChain): boolean {
  const target = scopeKey(documentScope(link.documentId))
  if (link.scope === 'document') {
    const first = chain[0]
    return first !== undefined && scopeKey(first) === target
  }
  return chain.some((scope) => scopeKey(scope) === target)
}

/**
 * What the link grants over the document this chain governs: its role at its
 * target document, or nothing at all.
 *
 * The grant is synthesised from the link rather than written into the grants
 * table, because the table cannot tell the two scopes apart: a grant at a
 * document scope is inherited by everything nested under it, which is what a
 * subtree link means and precisely what a document link must not do.
 *
 * Nothing else is granted. A link that does not reach this document
 * contributes no allow, so the share-link principal simply has no say — and a
 * *deny* written against that principal is still read from the grants table
 * like any other, which is how a document is carved out of a subtree link
 * (ADR-012's amendment: a deny on a link closes that channel only).
 */
export function shareLinkGrants(link: ShareLink, chain: ScopeChain): readonly Grant[] {
  if (!shareLinkCovers(link, chain)) return []
  return [
    {
      principal: shareLinkPrincipal(link.id),
      scope: documentScope(link.documentId),
      role: link.role,
      effect: 'allow',
    },
  ]
}
