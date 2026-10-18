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

/** `GET /api/home`: the signed-in home's figures and its two short lists, already bounded. */
export type HomeSummaryDto = GetBody<'/api/home'>

/** `GET /api/documents/:id/review`: the open review request on a document, or its latest closed one (ADR-052). */
export type ReviewRequestDto = NonNullable<GetBody<'/api/documents/{id}/review'>['request']>

/** One reviewer's place on a request: a person or a group, and whether they have answered. */
export type ReviewAssignmentDto = ReviewRequestDto['assignments'][number]

/** `GET /api/documents/:id/reviewer-candidates`: the people and groups who could be asked. */
export type ReviewerCandidates = GetBody<'/api/documents/{id}/reviewer-candidates'>

/** `GET /api/me/attention`: what is waiting on the signed-in person (ADR-053). */
export type AttentionItem = GetBody<'/api/me/attention'>['items'][number]

/** `GET /api/me/notifications`: what has happened that concerns the signed-in person (ADR-052). */
export type NotificationsDto = GetBody<'/api/me/notifications'>

export type NotificationItem = NotificationsDto['items'][number]

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
  /** How many documents sit at the top level; more than `documents` when cut or paged. */
  readonly documentCount?: number
  /** Where `documents` starts among them. */
  readonly documentsOffset?: number
  /** Every document in the collection the reader can see, nesting included. */
  readonly total?: number
}

/** `GET /workspaces/:id/tree/children`'s response: one page of a list in the tree. */
export type TreeChildrenResponse = GetBody<'/api/workspaces/{id}/tree/children'>

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

/** `POST /documents/:id/draft/revert`: the draft's new version, and what it held before. */
export type PutBackResponse = Json<
  NonNullable<paths['/api/documents/{id}/draft/revert']['post']>['responses'][200]
>

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

/** `GET /documents/:id/children`: what fills a child pages slot, for this reader (ADR-058). */
export type ChildPagesList = GetBody<'/api/documents/{id}/children'>

/** `GET /documents/:id/envelope`: everything that is a property of now, not of the revision. */
export type DocumentEnvelope = GetBody<'/api/documents/{id}/envelope'>

/** What the envelope's `permissions` gate: the Edit and Publish affordances. */
export type DocumentPermissions = DocumentEnvelope['permissions']

/** A quality indicator, never an error (ADR-029, ADR-031). */
export type HealthSignal = DocumentEnvelope['health'][number]

/** `GET /documents/:id/history`: revisions touching this document, newest first. */
export type DocumentHistory = GetBody<'/api/documents/{id}/history'>

export type RevisionSummary = DocumentHistory['revisions'][number]

/** `GET /documents/:id/compare?from=&to=`: two versions as one page, and what changed. */
export type Comparison = GetBody<'/api/documents/{id}/compare'>

export type ComparisonChange = Comparison['changes'][number]

export type ComparisonSection = Comparison['sections'][number]

/** `GET /documents/:id/compare/source?from=&to=`: the two versions' Markdown by line. */
export type SourceComparison = GetBody<'/api/documents/{id}/compare/source'>

export type SourceLine = SourceComparison['lines'][number]

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

/* --- Settings and secrets (`docs/architecture/api-contract-settings.md`) --- */

/**
 * The organisation's settings document: name, logo, theme, the default
 * layout, the public site's navigation, and the policies (ADR-034). Derived
 * from the generated client, so a server change that is not additive fails to
 * type-check here before it can reach a settings screen.
 */
export type OrganisationSettings = components['schemas']['OrganisationSettings']

/** `GET /settings/organisation`: the document, and the revision it was read at. */
export type OrganisationSettingsResponse = GetBody<'/api/settings/organisation'>

type OrganisationPutResponses = NonNullable<paths['/api/settings/organisation']['put']>['responses']

/** `PUT /settings/organisation`: the saved document, its new revision, and the doctor's verdict. */
export type SavedOrganisationSettings = Json<OrganisationPutResponses[200]>

/**
 * `GET /settings/organisation/theme`: the identity `<html>` carries in
 * `data-theme-id`, and the stylesheet to link (ADR-028, "Delivery"). Public:
 * every page renders with the theme, share links and sign-in included.
 */
export type OrganisationThemeSummary = GetBody<'/api/settings/organisation/theme'>

/** The theme document as the wire carries it; `@quill/theme`'s `ThemeDocument` is the same shape. */
export type ThemeSettings = OrganisationSettings['theme']

/**
 * The public site's header menu (settings version 2): links to documents and
 * collections by id, to addresses, and dropdown groups of links.
 */
export type PublicMenu = OrganisationSettings['publicMenu']

export type PublicMenuItem = PublicMenu[number]

export type PublicMenuGroup = Extract<PublicMenuItem, { kind: 'group' }>

/** A link, standalone or inside a dropdown. */
export type PublicMenuLink = PublicMenuGroup['items'][number]

/** `GET /settings/organisation/public-menu/targets`: what each document or collection a menu names is now. */
export type PublicMenuTarget = components['schemas']['PublicMenuTarget']

/** `GET /settings/organisation/public-menu/collections`: a collection a link could point at. */
export type CollectionCandidate = components['schemas']['PublicMenuCollectionCandidate']

/** ADR-028's bounded set of signature variants, chosen per workspace. */
export type LayoutSettings = OrganisationSettings['layout']['default']

/** `GET /workspaces/:idOrSlug/settings`: the workspace's own settings and what they resolve to. */
export type WorkspaceSettingsResponse = GetBody<'/api/workspaces/{id}/settings'>

export type WorkspaceSettingsDocument = WorkspaceSettingsResponse['settings']

/**
 * A secret's metadata. There is deliberately no shape with a value in it: the
 * API never answers with one (`docs/architecture/api-contract-settings.md`).
 */
export type SecretDto = components['schemas']['Secret']

/**
 * `GET /auth/oidc/providers`: what the sign-in page may offer (ADR-011).
 * Deliberately only an id and a label — it is read before anybody has signed
 * in, so it must say nothing about who uses the instance.
 */
export type OidcProviderList = GetBody<'/api/auth/oidc/providers'>

export type OidcProviderSummary = OidcProviderList['providers'][number]

/* --- Search (M3, ADR-010; `docs/architecture/api-contract-m2.md`) ---------- */

/**
 * `GET /search?q=&workspace=&limit=&cursor=`.
 *
 * Search is the one surface that crosses workspaces (quill-plan.md §15), so
 * the answer is shaped that way rather than as one flat list: `current` is
 * what matched in the workspace the caller is in, and `elsewhere` is every
 * other workspace they may read, grouped, each group ordered by its own best
 * match.
 */
export type SearchResults = GetBody<'/api/search'>

/**
 * The counts that let a results page offer ways to narrow itself
 * (`facets=` on `GET /api/search`): one list of values per facet asked for.
 */
export type SearchFacets = NonNullable<SearchResults['facets']>

/** The facets the server can count, in the order the page shows them. */
export type FacetName = keyof SearchFacets

/**
 * One value of a facet: `value` is exactly what follows the filter key
 * (`tag:<value>`), `label` is what to show, `count` is over the whole match
 * set rather than the page.
 */
export type FacetValue = NonNullable<SearchFacets[FacetName]>[number]

/** One matching document, wherever it lives. */
export type SearchHit = SearchResults['current'][number]

/** One other workspace's matches, with the workspace they are in. */
export type SearchGroup = SearchResults['elsewhere'][number]

/**
 * A hit's snippet: plain text plus the matched spans as offsets into it, never
 * HTML (ADR-010). Turning it into marks is `features/search/snippet.ts`'s job.
 */
export type SearchSnippet = SearchHit['snippet']

/** `GET /search/suggestions`: the values a filter could take, each as it is written and as it is shown. */
export type SearchSuggestions = GetBody<'/api/search/suggestions'>

export type SearchSuggestion = SearchSuggestions['suggestions'][number]

/** The filters the server can suggest values for. */
export type SearchSuggestionField = NonNullable<
  paths['/api/search/suggestions']['get']['parameters']['query']
>['field']

/* --- Share links (`docs/architecture/api-contract-share-links.md`) --------- */

/**
 * One link on a document, as the management list reports it. Its `role` is
 * every role the platform has rather than the one role a link may carry
 * today, because an administrator must be able to see — and revoke — a link
 * written by a newer release (ADR-033).
 */
export type ShareLinkDto = components['schemas']['ShareLink']

export type ShareLinkScope = ShareLinkDto['scope']

type ShareLinkResponses = NonNullable<paths['/api/documents/{id}/share-links']['post']>['responses']

/**
 * `POST /documents/:id/share-links`: the link, **the raw token, once**, and
 * the address it makes. Only the token's SHA-256 is stored, so nothing can
 * produce it a second time — which is why the dialog says so beside it.
 */
export type CreatedShareLink = Json<ShareLinkResponses[201]>

/** `GET /documents/:id/share-links`: every link on the document, newest first. */
export type ShareLinkList = GetBody<'/api/documents/{id}/share-links'>

/** `GET /share/:token`: the link, its target, the published body, and the navigation. */
export type SharedDocument = GetBody<'/api/share/{token}'>

/** `GET /share/:token/documents/:id/rendered`: one document inside a subtree link. */
export type SharedBody = GetBody<'/api/share/{token}/documents/{id}/rendered'>

/** A document a share-link reader may move to, and the ones below it. */
export type SharedNode = components['schemas']['SharedNode']

/** What a reader is told about the link they are holding: nothing about who made it. */
export type SharedLink = SharedDocument['link']

/** `GET /api/groups`: one group with the unit it belongs to and how many people are in it. */
export type GroupSummaryDto = GetBody<'/api/groups'>['groups'][number]

/** `GET /api/people`: somebody an administrator can add to a group. */
export type PersonDto = GetBody<'/api/people'>['people'][number]
