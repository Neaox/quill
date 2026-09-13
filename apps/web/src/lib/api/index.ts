export { ApiClientProvider, useApiClient } from './client-context.tsx'
export {
  createQueryClient,
  clearSessionState,
  type QueryClientOptions,
  type UnauthorizedHandler,
} from './query-client.ts'
export { queryKeys } from './query-keys.ts'
export { ApiError, toApiError, type ApiErrorBody } from './errors.ts'
export { request, type FetchResult } from './http.ts'

export {
  meQueryOptions,
  useMe,
  useSignIn,
  useSignUp,
  useSignOut,
  useRequestMagicLink,
  useConsumeMagicLink,
  useRequestPasswordReset,
  useConfirmPasswordReset,
  useVerifyEmail,
  type SignInInput,
  type SignUpInput,
  type RequestMagicLinkInput,
  type ConfirmPasswordResetInput,
} from './auth.ts'
export { useOidcProviders, oidcStartPath } from './oidc.ts'

export {
  unitsQueryOptions,
  useUnits,
  useCreateUnit,
  useRenameUnit,
  useDeleteUnit,
  readUnitNotEmptyDetails,
  type CreateUnitInput,
  type RenameUnitInput,
  type UnitNotEmptyDetails,
} from './units.ts'
export {
  useCreateCollection,
  useRenameCollection,
  useDeleteCollection,
  readDocumentCount,
  type CreateCollectionInput,
  type RenameCollectionInput,
  type DeleteCollectionInput,
} from './collections.ts'
export {
  workspaceQueryOptions,
  workspaceListQueryOptions,
  useWorkspace,
  useLoadedWorkspace,
  useWorkspaceList,
  useCreateWorkspace,
  useRenameWorkspace,
  useDeleteWorkspace,
  type CreateWorkspaceInput,
  type RenameWorkspaceInput,
} from './workspaces.ts'
export {
  documentQueryOptions,
  workspaceDocumentsQueryOptions,
  workspaceTreeQueryOptions,
  useDocuments,
  useDocument,
  useLoadedDocument,
  useCreateDocument,
  useRenameDocument,
  useMoveDocument,
  useDeleteDocument,
  useWorkspaceTree,
  type CreateDocumentInput,
  type RenameDocumentInput,
  type MoveDocumentInput,
  type DeleteDocumentInput,
} from './documents.ts'
export { draftQueryOptions, useDraft, useSaveDraft, type SaveDraftInput } from './drafts.ts'
export { useAcquireLock, useHeartbeatLock, useReleaseLock, useTakeoverLock } from './locks.ts'
export {
  renderedQueryOptions,
  useDocumentEnvelope,
  useDocumentHistory,
  usePublishedContent,
  useRenderedDocument,
  useRevisionDiff,
  type CachedRenderedDocument,
  type DiffRange,
} from './content.ts'
export {
  usePublishDocument,
  useRestoreRevision,
  type PublishInput,
  type PublishOutcome,
  type RestoreInput,
} from './publishing.ts'
export { useDraftClient, useLockClient } from './editor-clients.ts'

export type {
  CollectionDto,
  MeResponse,
  SignInResponse,
  SignUpResponse,
  MagicLinkPurpose,
  OidcProviderList,
  OidcProviderSummary,
  UnitDto,
  WorkspaceDto,
  WorkspaceSummaryDto,
  DocumentDto,
  DraftDto,
  SaveDraftResponse,
  LockHolderDto,
  AcquireLockResponse,
  HeartbeatResponse,
  TakeoverResponse,
  CreateDocumentResponse,
  CreateDraftDto,
  CreateDocumentWarning,
  TreeCollectionDto,
  WorkspaceTreeResponse,
  OutlineEntry,
  RenderedDocument,
  DocumentEnvelope,
  DocumentPermissions,
  HealthSignal,
  DocumentHistory,
  RevisionSummary,
  RevisionDiff,
  PublishedContent,
  PublishedResult,
  MergeRequired,
  MergeConflict,
} from './types.ts'
