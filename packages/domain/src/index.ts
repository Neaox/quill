export type {
  CollectionId,
  DocumentId,
  GroupId,
  InstanceId,
  RevisionId,
  ShareLinkId,
  ShortId,
  UnitId,
  UserId,
  WorkspaceId,
} from './ids.ts'
export {
  collectionId,
  documentId,
  groupId,
  instanceId,
  isShortId,
  isUuid,
  revisionId,
  shareLinkId,
  shortId,
  unitId,
  userId,
  workspaceId,
} from './ids.ts'

export {
  canonicalShortId,
  SHORT_ID_ALPHABET,
  SHORT_ID_BYTES,
  SHORT_ID_LENGTH,
  shortIdFrom,
} from './short-id.ts'

export { MAX_SLUG_LENGTH, slugify } from './slug.ts'

export type { Result } from './result.ts'
export { err, ok } from './result.ts'

export type { DocumentStatus } from './document-status.ts'
export { DOCUMENT_STATUSES, isDocumentStatus } from './document-status.ts'

export type { Role } from './roles.ts'
export { ROLES, canComment, canEdit, canManage, canOwn, canView, roleAtLeast } from './roles.ts'

export type { Instance } from './tenancy/instance.ts'
export type { OrganisationalUnit } from './tenancy/organisational-unit.ts'
export type { Workspace } from './tenancy/workspace.ts'
export type { Collection } from './tenancy/collection.ts'
export type { Document } from './tenancy/document.ts'
export type { Group } from './tenancy/group.ts'
export type { User } from './tenancy/user.ts'

export type {
  GroupPrincipal,
  Principal,
  PublicPrincipal,
  ShareLinkPrincipal,
  UserPrincipal,
} from './permissions/principal.ts'
export {
  PUBLIC_PRINCIPAL,
  groupPrincipal,
  principalKey,
  shareLinkPrincipal,
  userPrincipal,
} from './permissions/principal.ts'

export type {
  CollectionScope,
  DocumentScope,
  InstanceScope,
  Scope,
  ScopeKind,
  UnitScope,
  WorkspaceScope,
} from './permissions/scope.ts'
export {
  INSTANCE_SCOPE,
  SCOPE_KINDS,
  collectionScope,
  documentScope,
  scopeKey,
  scopeSpecificity,
  unitScope,
  workspaceScope,
} from './permissions/scope.ts'

export type { Capabilities } from './permissions/capabilities.ts'
export { NO_CAPABILITIES, capabilitiesForRole } from './permissions/capabilities.ts'

export type { Grant, GrantEffect, GrantViolation } from './permissions/grant.ts'
export { GRANT_EFFECTS, validateGrant } from './permissions/grant.ts'

export type { CombinedPermission, Contribution } from './permissions/combine.ts'
export { combineContributions } from './permissions/combine.ts'

export type { ScopeChain, ScopeChainFailure, ScopeChainInput } from './permissions/scope-chain.ts'
export {
  buildDocumentAncestorChain,
  buildScopeChain,
  buildUnitChain,
} from './permissions/scope-chain.ts'

export type {
  ShareLink,
  ShareLinkRole,
  ShareLinkScope,
  ShareLinkState,
} from './permissions/share-link.ts'
export {
  SHARE_LINK_ROLES,
  SHARE_LINK_SCOPES,
  isShareLinkRole,
  isShareLinkScope,
  shareLinkCovers,
  shareLinkGrants,
  shareLinkState,
} from './permissions/share-link.ts'

export type { RequestIdentity } from './permissions/identities.ts'
export { principalIdentities } from './permissions/identities.ts'

export type { EffectivePermission, ResolvePermissionInput } from './permissions/resolve.ts'
export { NO_PERMISSION, resolvePermission } from './permissions/resolve.ts'

export type {
  CollectionNode,
  EffectivePermissionRow,
  MaterialiseInput,
  WorkspaceTree,
} from './permissions/materialise.ts'
export { materialiseEffectivePermissions } from './permissions/materialise.ts'
