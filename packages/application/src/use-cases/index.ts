export type {
  Access,
  AccessFailure,
  Authorizer,
  AuthorizerRepositories,
  CollectionAccess,
  DocumentAccess,
  RequestPrincipal,
  WorkspaceAccess,
} from './authorizer.ts'
export { createAuthorizer, toGrants } from './authorizer.ts'

export type {
  DocumentCreatedPayload,
  DocumentPublishedPayload,
  DocumentRenamedPayload,
  MailRequestedPayload,
} from './events.ts'
export {
  DOCUMENT_CREATED,
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
  EVENT_PAYLOAD_VERSION,
  MAIL_REQUESTED,
  parseDocumentPublished,
  parseDocumentRenamed,
  parseMailRequested,
} from './events.ts'

export type { DocumentPlacement, DocumentReference, PathCandidate } from './document-path.ts'
export {
  canonicaliseDocumentLinks,
  directoryOf,
  documentIdFromUrl,
  documentPath,
  documentPathCandidates,
  documentReference,
  documentReferenceFromUrl,
  documentUrl,
  linkedDocumentIds,
  linkedDocumentReferences,
  MAX_PATH_ATTEMPTS,
  namedSlug,
  parseDocumentReference,
  slugify,
  UNTITLED_SLUG,
  workspaceLinkReferences,
} from './document-path.ts'

export { canonicaliseLinks } from './canonical-links.ts'

export type {
  DocumentReferenceMatch,
  ResolveDocumentReferenceCommand,
  ResolveDocumentReferenceResult,
  ResolveReferenceDependencies,
  ResolveWorkspaceReferenceCommand,
  ResolveWorkspaceReferenceResult,
  WorkspaceReferenceMatch,
} from './resolve-reference.ts'
export {
  resolveDocumentReference,
  resolveWorkspaceReference,
  WORKSPACE_SLUG_HISTORY_TTL_MS,
} from './resolve-reference.ts'

export type {
  CreateDocumentCommand,
  CreateDocumentDependencies,
  CreateDocumentResult,
} from './create-document.ts'
export { createDocument, MAX_SHORT_ID_ATTEMPTS } from './create-document.ts'

export type {
  CollectionDependencies,
  CreateCollectionCommand,
  CreateCollectionResult,
  DeleteCollectionCommand,
  DeleteCollectionResult,
  ListCollectionsCommand,
  RenameCollectionCommand,
  RenameCollectionResult,
} from './collections.ts'
export {
  COLLECTION_AUDIT_EVENTS,
  createCollection,
  deleteCollection,
  listCollections,
  renameCollection,
} from './collections.ts'

export type {
  CreateShareLinkCommand,
  CreateShareLinkResult,
  ListShareLinksCommand,
  RecordShareLinkUseCommand,
  ResolveShareLinkCommand,
  ResolvedShareLink,
  RevokeShareLinkCommand,
  RevokeShareLinkResult,
  ShareLinkDependencies,
  ShareLinkPolicy,
  ShareLinkRefusal,
  SharedNavigationNode,
} from './share-links.ts'
export {
  SHARE_LINK_AUDIT_EVENTS,
  createShareLink,
  findShareLink,
  listShareLinks,
  recordShareLinkUse,
  resolveShareLink,
  revokeShareLink,
  shareLinkNavigation,
  toShareLink,
} from './share-links.ts'

export type {
  CreateGrantCommand,
  CreateGrantDependencies,
  CreateGrantResult,
} from './create-grant.ts'
export { createGrant } from './create-grant.ts'

export type {
  LockLostOutcome,
  PublishAuthor,
  PublishDependencies,
  PublishDocumentCommand,
  PublishDocumentResult,
  PublishedOutcome,
  RecordPublishInput,
  RecordPublishResult,
} from './publish-document.ts'
export { publishDocument, readDraftContent, recordPublish } from './publish-document.ts'

export type {
  DeleteDocumentCommand,
  DeleteDocumentResult,
  UpdateDocumentCommand,
  UpdateDocumentDependencies,
  UpdateDocumentPatchInput,
  UpdateDocumentResult,
} from './update-document.ts'
export { deleteDocument, DOCUMENT_AUDIT_EVENTS, updateDocument } from './update-document.ts'

export type {
  CreateUnitCommand,
  CreateUnitResult,
  CreateWorkspaceCommand,
  CreateWorkspaceResult,
  DeleteUnitCommand,
  DeleteUnitResult,
  DeleteWorkspaceCommand,
  DeleteWorkspaceResult,
  RenameUnitCommand,
  RenameUnitResult,
  RenameWorkspaceCommand,
  RenameWorkspaceResult,
  TenancyDependencies,
} from './tenancy.ts'
export {
  createUnit,
  createWorkspace,
  deleteUnit,
  deleteWorkspace,
  renameUnit,
  renameWorkspace,
  TENANCY_AUDIT_EVENTS,
} from './tenancy.ts'

export type { RestoreRevisionCommand, RestoreRevisionResult } from './restore-revision.ts'
export { restoreRevision } from './restore-revision.ts'

export type {
  ReadPublishedCommand,
  ReadPublishedDependencies,
  ReadPublishedResult,
} from './read-published.ts'
export { readPublished } from './read-published.ts'

export type {
  RenderDocumentCommand,
  RenderDocumentDependencies,
  RenderDocumentResult,
  RenderedDocument,
} from './render-document.ts'
export {
  renderCacheKey,
  renderDigest,
  renderDocument,
  renderSource,
  resolveLinks,
  RENDER_VERSION,
} from './render-document.ts'

export type { VersionedReader, VersionReader } from './versioned-reader.ts'
export { createVersionedReader } from './versioned-reader.ts'

export type {
  EnvelopeDependencies,
  EnvelopeView,
  GetEnvelopeCommand,
  GetEnvelopeResult,
  HealthSignal,
  HealthSignalKind,
  LastPublishedView,
  LockView,
  ReviewView,
} from './get-envelope.ts'
export { getEnvelope, reviewOf } from './get-envelope.ts'

export type {
  GetHistoryCommand,
  HistoryDependencies,
  HistoryPageView,
  RevisionSummaryView,
} from './get-history.ts'
export { getHistory, MAX_HISTORY_LIMIT } from './get-history.ts'

export type { DiffDependencies, GetDiffCommand, GetDiffResult } from './get-diff.ts'
export { getDiff } from './get-diff.ts'

export type {
  CollectionTree,
  GetWorkspaceTreeCommand,
  GetWorkspaceTreeResult,
  TreeNode,
  WorkspaceTreeDependencies,
} from './get-workspace-tree.ts'
export { getWorkspaceTree } from './get-workspace-tree.ts'

export type {
  ListVisibleDocumentsCommand,
  ListVisibleDocumentsResult,
  VisibilityInput,
  VisibilityOutcome,
  VisibleDocumentsDependencies,
} from './list-visible-documents.ts'
export { listVisibleDocuments, visibleDocumentIds } from './list-visible-documents.ts'

export type {
  ListVisibleWorkspacesCommand,
  ListVisibleWorkspacesResult,
  VisibleWorkspace,
  VisibleWorkspacesDependencies,
} from './list-visible-workspaces.ts'
export { listVisibleWorkspaces } from './list-visible-workspaces.ts'

export {
  documentsById,
  toCollectionEntity,
  toDocumentEntity,
  toGroupEntity,
  toUnitEntity,
  toWorkspaceEntity,
  unitsById,
} from './tenancy-entities.ts'
