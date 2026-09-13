import type { Role } from '../roles.ts'
import { canComment, canEdit, canManage, canOwn, canView } from '../roles.ts'

/**
 * What a principal may do, once the role has been resolved.
 *
 * Callers ask "may I edit?" rather than comparing roles themselves, so the
 * ordering of roles stays a detail of this package.
 */
export interface Capabilities {
  readonly view: boolean
  readonly comment: boolean
  readonly edit: boolean
  readonly manage: boolean
  readonly own: boolean
}

/** No applicable grant, or an explicit deny. */
export const NO_CAPABILITIES: Capabilities = {
  view: false,
  comment: false,
  edit: false,
  manage: false,
  own: false,
}

export function capabilitiesForRole(role: Role): Capabilities {
  return {
    view: canView(role),
    comment: canComment(role),
    edit: canEdit(role),
    manage: canManage(role),
    own: canOwn(role),
  }
}
