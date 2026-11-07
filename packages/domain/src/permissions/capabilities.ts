import type { Role } from '../roles.ts'
import {
  canArrange,
  canComment,
  canEdit,
  canManage,
  canOwn,
  canPublish,
  canView,
} from '../roles.ts'
import type { WorkspaceOrigin } from '../tenancy/workspace-origin.ts'

/**
 * What a principal may do, once the role has been resolved.
 *
 * Callers ask "may I edit?" rather than comparing roles themselves, so the
 * ordering of roles stays a detail of this package.
 */
export interface Capabilities {
  readonly view: boolean
  readonly comment: boolean
  /** Write the draft. */
  readonly edit: boolean
  /** Make a draft live as a revision. Held by editors and above; a contributor asks for a review. */
  readonly publish: boolean
  /**
   * Change the tree: rename, move and delete documents, and create, rename and
   * delete collections (ADR-061). Granted wherever `manage` is, and split from
   * it so that a workspace whose structure comes from elsewhere can turn it off
   * while keeping access and settings.
   */
  readonly arrange: boolean
  /** Grant access, share links, settings and the public site. */
  readonly manage: boolean
  readonly own: boolean
}

/** No applicable grant, or an explicit deny. */
export const NO_CAPABILITIES: Capabilities = {
  view: false,
  comment: false,
  edit: false,
  publish: false,
  arrange: false,
  manage: false,
  own: false,
}

export function capabilitiesForRole(role: Role): Capabilities {
  return {
    view: canView(role),
    comment: canComment(role),
    edit: canEdit(role),
    publish: canPublish(role),
    arrange: canArrange(role),
    manage: canManage(role),
    own: canOwn(role),
  }
}

/**
 * What a workspace's origin leaves of the capabilities a role grants in it
 * (ADR-061).
 *
 * A sourced workspace's content is written only by its sync job, so writing
 * (`edit`, `publish`) and changing the tree (`arrange`) are off for everyone,
 * instance administrators included. Reading, commenting, granting access and
 * ownership are unchanged. It only ever takes away, so applying it after
 * resolution cannot widen what a grant said.
 */
export function narrowByOrigin(capabilities: Capabilities, origin: WorkspaceOrigin): Capabilities {
  switch (origin.kind) {
    case 'native':
      return capabilities
    case 'sourced':
      return { ...capabilities, edit: false, publish: false, arrange: false }
  }
}
