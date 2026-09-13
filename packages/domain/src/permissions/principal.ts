import type { GroupId, ShareLinkId, UserId } from '../ids.ts'

export interface UserPrincipal {
  readonly kind: 'user'
  readonly userId: UserId
}

export interface GroupPrincipal {
  readonly kind: 'group'
  readonly groupId: GroupId
}

export interface PublicPrincipal {
  readonly kind: 'public'
}

export interface ShareLinkPrincipal {
  readonly kind: 'share-link'
  readonly shareLinkId: ShareLinkId
}

/**
 * Anything a grant can be attached to.
 *
 * The public principal and share links are principals like any other, so
 * anonymous readers travel the same resolution path as members and there is no
 * second, weaker code path to get wrong (ADR-012).
 */
export type Principal = UserPrincipal | GroupPrincipal | PublicPrincipal | ShareLinkPrincipal

/** Everyone, signed in or not. A public collection is a viewer grant to this. */
export const PUBLIC_PRINCIPAL: PublicPrincipal = { kind: 'public' }

export function userPrincipal(id: UserId): UserPrincipal {
  return { kind: 'user', userId: id }
}

export function groupPrincipal(id: GroupId): GroupPrincipal {
  return { kind: 'group', groupId: id }
}

export function shareLinkPrincipal(id: ShareLinkId): ShareLinkPrincipal {
  return { kind: 'share-link', shareLinkId: id }
}

/**
 * A stable key for set and map membership.
 *
 * The kind is part of the key so a user and a group that happen to share a UUID
 * can never be mistaken for each other.
 */
export function principalKey(principal: Principal): string {
  switch (principal.kind) {
    case 'user':
      return `user:${principal.userId}`
    case 'group':
      return `group:${principal.groupId}`
    case 'share-link':
      return `share-link:${principal.shareLinkId}`
    case 'public':
      return 'public'
  }
}
