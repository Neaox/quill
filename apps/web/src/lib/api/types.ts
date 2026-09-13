import type { DocumentStatus } from '@quill/domain'

import type { components, paths } from '@quill/api-client'

/** A node in a workspace tree collection's document list (nested children included). */
type TreeNode = components['schemas']['TreeNode']

/** The JSON body of one generated response. */
type Json<Response> = Response extends { content: { 'application/json': infer Body } }
  ? Body
  : never

/** The 200 body of one generated `GET`. */
type GetBody<Path extends keyof paths> = Json<NonNullable<paths[Path]['get']>['responses'][200]>

/**
 * Wire DTOs for the routes in `packages/api-client/src/schema.gen.d.ts`.
 *
 * The M2 content routes declare response schemas, so their shapes are
 * **derived** from the generated file below rather than restated: a server
 * change that is not additive then fails to type-check here before it can
 * reach a screen (ADR-033), which is the whole reason the client is
 * generated. The M1 routes (drafts, locks, auth) still declare their
 * responses as `content?: never` — their TypeBox schemas describe the
 * request but not the reply — so `openapi-typescript` has nothing to
 * generate from and those DTOs stay hand-written, read from the route
 * handlers, `packages/application`'s ports, and
 * `docs/architecture/api-contract-m2.md`. Each one becomes a `GetBody`
 * alias the day its route declares a schema.
 *
 * Dates are ISO strings throughout: everything here is what arrives after
 * `JSON.parse`, not the server's `Date`-typed row.
 */

export interface MeResponse {
  readonly id: string
  readonly email: string
  readonly displayName: string
  readonly emailVerified: boolean
  readonly isInstanceAdmin: boolean
}

export interface SignUpResponse {
  readonly userId: string
}

export interface SignInResponse {
  readonly userId: string
}

export type MagicLinkPurpose = 'sign-in' | 'email-verification' | 'password-reset'

export interface UnitDto {
  readonly id: string
  readonly parentId: string | null
  readonly name: string
  readonly slug: string
  /** The administrator's own noun for this level, such as "company" or "team" (ADR-012). */
  readonly label: string
  readonly createdAt: string
}

export interface WorkspaceDto {
  readonly id: string
  readonly unitId: string
  readonly name: string
  readonly slug: string
  readonly createdAt: string
}

/** One row of `GET /api/workspaces`: a workspace the caller can see, with its unit. */
export interface WorkspaceSummaryDto extends WorkspaceDto {
  readonly unit: {
    readonly id: string
    readonly name: string
    /** Unit names from the root down to this unit, for grouping and display. */
    readonly path: readonly string[]
  }
}

export interface DocumentDto {
  readonly id: string
  /** The document's ten-character public handle, stable for its lifetime (ADR-035). */
  readonly shortId: string
  readonly workspaceId: string
  readonly collectionId: string | null
  readonly parentId: string | null
  readonly slug: string
  readonly path: string
  readonly title: string
  readonly status: DocumentStatus
  readonly templateId: string | null
  readonly templateVersion: number | null
  /** The published revision this document is currently at, or `null` before its first publish. */
  readonly headRevision: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateDraftDto {
  readonly documentId: string
  readonly draftVersion: number
  readonly baseRevision: string | null
  readonly updatedAt: string
}

export interface CreateDocumentWarning {
  readonly code: string
  readonly detail?: string
}

/** `POST /workspaces/:workspaceId/documents`'s response envelope. */
export interface CreateDocumentResponse {
  readonly document: DocumentDto
  readonly draft: CreateDraftDto
  readonly requiredSections: readonly string[]
  readonly warnings: readonly CreateDocumentWarning[]
}

/** `GET/POST/PATCH /(workspaces/:id|collections/:id)/collections`'s shape (`schema.gen.d.ts`'s `Collection`). */
export type CollectionDto = components['schemas']['Collection']

export interface TreeCollectionDto {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly documents: readonly TreeNode[]
}

/** `GET /workspaces/:id/tree`'s response (`docs/architecture/api-contract-m2.md`). */
export interface WorkspaceTreeResponse {
  readonly collections: readonly TreeCollectionDto[]
}

export interface DraftDto {
  readonly documentId: string
  readonly draftVersion: number
  readonly baseRevision: string | null
  readonly ast: unknown
  readonly updatedAt: string
}

export interface SaveDraftResponse {
  readonly draftVersion: number
  readonly updatedAt: string
}

/** `423 lock_lost`'s and `409 held`'s `details.holder` (ADR-021). */
export interface LockHolderDto {
  readonly documentId: string
  readonly holderUserId: string
  readonly holderSessionId: string
  readonly acquiredAt: string
  readonly lastHeartbeatAt: string
  readonly expiresAt: string
}

export interface AcquireLockResponse {
  readonly lock: LockHolderDto
}

export interface HeartbeatResponse {
  readonly expiresAt: string
}

export interface TakeoverResponse {
  readonly lock: LockHolderDto
}

/* --- The M2 content routes (`docs/architecture/api-contract-m2.md`) -------- */

/** One heading in a document's outline, with its children. */
export type OutlineEntry = components['schemas']['OutlineEntry']

/** `GET /documents/:id/rendered`: the cached body, outline, and live-block slots (ADR-031). */
export type RenderedDocument = GetBody<'/api/documents/{id}/rendered'>

/** `GET /documents/:id/envelope`: everything that is a property of now, not of the revision. */
export type DocumentEnvelope = GetBody<'/api/documents/{id}/envelope'>

/** What the envelope's `permissions` gate: the Edit and Publish affordances. */
export type DocumentPermissions = DocumentEnvelope['permissions']

/** A quality indicator, never an error (ADR-029, ADR-031). */
export type HealthSignal = DocumentEnvelope['health'][number]

/** `GET /documents/:id/history`: revisions touching this document, newest first. */
export type DocumentHistory = GetBody<'/api/documents/{id}/history'>

export type RevisionSummary = DocumentHistory['revisions'][number]

/** `GET /documents/:id/diff?from=&to=`: a unified diff and its line counts. */
export type RevisionDiff = GetBody<'/api/documents/{id}/diff'>

/** `GET /documents/:id/content`: the published Markdown source. */
export type PublishedContent = GetBody<'/api/documents/{id}/content'>

type PublishResponses = NonNullable<paths['/api/documents/{id}/publish']['post']>['responses']

/** `POST /documents/:id/publish` succeeded: a new revision exists. */
export type PublishedResult = Json<PublishResponses[200]>

/**
 * `409 merge-required`: someone else published while this draft was based on
 * an older revision. `conflicts` carries the three texts a person needs to
 * decide — `base`, `ours`, `theirs` — plus the merged text with markers.
 */
export type MergeRequired = Json<PublishResponses[409]>

export type MergeConflict = MergeRequired['conflicts'][number]
