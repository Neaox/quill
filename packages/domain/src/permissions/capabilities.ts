import type { Role } from '../roles.ts'
import { canComment, canEdit, canManage, canOwn, canPublish, canView } from '../roles.ts'

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
  readonly manage: boolean
  readonly own: boolean
}

/** No applicable grant, or an explicit deny. */
export const NO_CAPABILITIES: Capabilities = {
  view: false,
  comment: false,
  edit: false,
  publish: false,
  manage: false,
  own: false,
}

export function capabilitiesForRole(role: Role): Capabilities {
  return {
    view: canView(role),
    comment: canComment(role),
    edit: canEdit(role),
    publish: canPublish(role),
    manage: canManage(role),
    own: canOwn(role),
  }
}
