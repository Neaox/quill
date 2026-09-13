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
/*
 * `attachments.ts` is deliberately *not* re-exported here.
 *
 * This barrel is what every route reads the API through, so a module reachable
 * from it is in the chunk every route loads — including the reading route,
 * which has a byte budget (quill-plan.md section 31) and no use for uploading.
 * The editor imports `lib/api/attachments.ts` by its own path, which is what
 * keeps the upload client in the editor's chunk. Please leave it that way; the
 * bundle gate is what notices if it moves.
 */
export { useDraftClient, useLockClient } from './editor-clients.ts'
export {
  MAX_QUERY_LENGTH,
  queryTooLong,
  readInvalidQuery,
  searchResultsQueryOptions,
  useSearch,
  useSearchResults,
  type InvalidQuery,
  type InvalidQueryKind,
  type SearchInput,
} from './search.ts'
export {
  shareLinksQueryOptions,
  useShareLinks,
  useCreateShareLink,
  useRevokeShareLink,
  type CreateShareLinkInput,
  type RevokeShareLinkInput,
} from './share-links.ts'
export {
  sharedBodyQueryOptions,
  sharedDocumentQueryOptions,
  useLoadedSharedBody,
  useLoadedSharedDocument,
} from './share-reading.ts'
export {
  organisationSettingsQueryOptions,
  secretsQueryOptions,
  workspaceSettingsQueryOptions,
  useOrganisationSettings,
  useLoadedOrganisationSettings,
  useSaveOrganisationSettings,
  useLoadedWorkspaceSettings,
  useSaveWorkspaceSettings,
  useSecrets,
  useSetSecret,
  useDeleteSecret,
  isLayoutLocked,
  isSettingsConflict,
  isSettingsUnreadable,
  readSettingsIssues,
  readUnreadableRevision,
  type SaveOrganisationSettingsInput,
  type SaveWorkspaceSettingsInput,
  type SetSecretInput,
  type SettingsIssue,
} from './settings.ts'

export type {
  CollectionDto,
  MeResponse,
  SignInResponse,
  SignUpResponse,
  MagicLinkPurpose,
  OidcProviderList,
  OidcProviderSummary,
  OrganisationSettings,
  OrganisationSettingsResponse,
  SavedOrganisationSettings,
  ThemeSettings,
  PublicNavigationLink,
  LayoutSettings,
  WorkspaceSettingsResponse,
  WorkspaceSettingsDocument,
  SecretDto,
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
  SearchResults,
  SearchHit,
  SearchSnippet,
  ShareLinkDto,
  ShareLinkScope,
  ShareLinkList,
  CreatedShareLink,
  SharedDocument,
  SharedBody,
  SharedLink,
  SharedNode,
} from './types.ts'
