/**
 * Roles granted to a principal at a scope (unit, workspace, collection, or
 * document). Effective permission resolution across the scope tree lives in
 * the permission module; this file defines the roles themselves and the
 * capabilities each one carries.
 */
export const ROLES = ['viewer', 'contributor', 'editor', 'admin', 'owner'] as const

export type Role = (typeof ROLES)[number]

const RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  contributor: 1,
  editor: 2,
  admin: 3,
  owner: 4,
}

/** True when `role` grants at least the capabilities of `minimum`. */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum]
}

export function canView(role: Role): boolean {
  return roleAtLeast(role, 'viewer')
}

/**
 * Contributors comment and write drafts but do not publish: they ask for a
 * review, and somebody who can publish makes the change live (ADR-052).
 */
export function canComment(role: Role): boolean {
  return roleAtLeast(role, 'contributor')
}

/** Write the draft: take its lock, change it, attach to it. Making it live is `canPublish`. */
export function canEdit(role: Role): boolean {
  return roleAtLeast(role, 'contributor')
}

/** Make a draft a revision readers see: publish, and restore, which publishes. */
export function canPublish(role: Role): boolean {
  return roleAtLeast(role, 'editor')
}

/**
 * Change the tree: rename, move and delete documents, and create, rename and
 * delete collections. Granted exactly where `canManage` is (ADR-061); it is a
 * capability of its own because a sourced workspace turns it off and keeps
 * `manage`.
 */
export function canArrange(role: Role): boolean {
  return roleAtLeast(role, 'admin')
}

/** Manage members, grants, share links, settings, and the public site. */
export function canManage(role: Role): boolean {
  return roleAtLeast(role, 'admin')
}

/** Transfer or delete the thing outright; an owner cannot be removed by an admin. */
export function canOwn(role: Role): boolean {
  return roleAtLeast(role, 'owner')
}
