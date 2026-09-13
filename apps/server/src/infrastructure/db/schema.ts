import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Drizzle schema for all system data (plan §11; ADR-012 tenancy; ADR-021
 * drafts and locking; plan §22 outbox; plan §23 authentication).
 *
 * Document content itself never lives here — only its metadata (`documents`)
 * and unpublished drafts. Published content lives in the content store
 * (`packages/content-store`), which this package does not yet depend on.
 *
 * Status and role columns are plain `text`, not Postgres enums, so the
 * extensible-string-union statuses and roles declared in the domain package
 * can grow without a schema migration (plan §35.14).
 */

export const instance = pgTable('instance', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const organisationalUnits = pgTable('organisational_units', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  slug: text('slug').notNull().default(''),
  /** The administrator's noun for this level, such as "company" or "team" (ADR-012). */
  label: text('label').notNull().default('unit'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

/**
 * One mailbox, one account.
 *
 * `email` is stored in the canonical form the service normalises to (trimmed
 * and lower-cased), and the index on `lower(email)` is what makes that a
 * guarantee rather than a convention: without it a second account could be
 * created for `Ada@example.com` beside `ada@example.com`, and the
 * existing-account protection that keeps sign-up from enumerating would
 * simply never fire across casings (ADR-011).
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    isInstanceAdmin: boolean('is_instance_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex('users_email_lower_key').on(sql`lower(${table.email})`)],
)

export const passwordCredentials = pgTable('password_credentials', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

/**
 * `id` is the opaque row key — what `document_locks.holder_session_id` and
 * the session-management routes name. The cookie carries a 256-bit token
 * whose SHA-256 is `token_hash`, so a database read yields nothing usable
 * (ADR-011). Both added columns are nullable because ADR-033 makes
 * migrations expand-only: rows written before this change simply have no
 * token hash, and `last_seen_at` falls back to `created_at`.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    /** Stamped on every authenticated request: the input to the idle timeout. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // Every "sign out everywhere", every rotation on a credential or
    // privilege change, and the account settings list filter on the user.
    index('sessions_user_id_idx').on(table.userId),
    // The sweep reads by expiry (`jobs/sweep-expired.ts`).
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
)

export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    purpose: text('purpose').notNull(),
    /**
     * SHA-256 of the "requested here" secret the issuing browser was given,
     * so consuming a link needs the browser that asked for it or an explicit
     * confirmation (ADR-011). Nullable because migrations are expand-only
     * (ADR-033): a token issued before this column existed simply has no
     * binding to check.
     */
    bindingHash: text('binding_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // Supersession retires every unconsumed token of one user and purpose on
    // every issue, so this is on the hot path of sending any link at all.
    index('magic_link_tokens_user_purpose_idx').on(table.userId, table.purpose),
    // The sweep reads by expiry (`jobs/sweep-expired.ts`).
    index('magic_link_tokens_expires_at_idx').on(table.expiresAt),
  ],
)

export const groups = pgTable('groups', {
  id: text('id').primaryKey(),
  unitId: text('unit_id')
    .notNull()
    .references(() => organisationalUnits.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('group_members_group_id_user_id_key').on(table.groupId, table.userId),
    // Resolving a request's identity starts from the user, not the group.
    index('group_members_user_id_idx').on(table.userId),
  ],
)

/**
 * A principal is the thing a grant attaches a role to: a user, a group, the
 * singleton `public` principal, or a share link. `refId` is null only for
 * `public`. `GrantRepository`'s Drizzle implementation upserts rows here as
 * an implementation detail; the port never exposes this table directly.
 */
export const principals = pgTable(
  'principals',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    refId: text('ref_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [unique('principals_kind_ref_id_key').on(table.kind, table.refId)],
)

/**
 * A grant attaches a role to a principal at a scope (ADR-012).
 *
 * Two of the model's rules are constraints here and not only checks in the
 * `CreateGrant` command, because a row that broke either of them would widen
 * access and nothing reading the table could tell it was a mistake: a deny is
 * only ever attached to a single document, and the public principal is never
 * an owner, because "anybody at all may administer this" is not something the
 * product offers.
 *
 * `principal_kind` is that second rule's price: a check constraint cannot read
 * another table, so the kind is materialised here beside the reference to the
 * principal. It is nullable because migrations are expand-only (ADR-033) —
 * rows written before the column existed carry null and are backfilled — and
 * `GrantRepository` writes it on every insert.
 */
export const grants = pgTable(
  'grants',
  {
    id: text('id').primaryKey(),
    principalId: text('principal_id')
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    principalKind: text('principal_kind'),
    scopeKind: text('scope_kind').notNull(),
    scopeId: text('scope_id'),
    role: text('role').notNull(),
    effect: text('effect').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // Every request resolves a whole scope chain at once.
    index('grants_scope_idx').on(table.scopeKind, table.scopeId),
    // And every permission walk asks for the grants its own principals hold,
    // wherever they are attached (`listVisibleDocuments`), which is the far
    // cheaper way to ask the same question of a whole workspace.
    index('grants_principal_idx').on(table.principalId),
    check(
      'grants_deny_is_document_scoped',
      sql`${table.effect} <> 'deny' OR ${table.scopeKind} = 'document'`,
    ),
    check(
      'grants_public_is_never_owner',
      sql`${table.principalKind} IS NULL OR ${table.principalKind} <> 'public' OR ${table.role} <> 'owner'`,
    ),
  ],
)

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  unitId: text('unit_id')
    .notNull()
    .references(() => organisationalUnits.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

/**
 * The slugs workspaces have stopped using, so links written before a rename
 * keep working (ADR-035).
 *
 * The slug is the primary key, not the pair: a slug belongs to one workspace
 * at a time, and retiring one a second time — after another workspace has
 * taken and released it — replaces the claim rather than adding a second one
 * that nothing could choose between. Entries older than a year are ignored by
 * the resolver and swept later.
 */
export const workspaceSlugHistory = pgTable(
  'workspace_slug_history',
  {
    slug: text('slug').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    retiredAt: timestamp('retired_at', { withTimezone: true }).notNull(),
  },
  // Every slug one workspace has ever used, for its settings page and for the sweep.
  (table) => [index('workspace_slug_history_workspace_idx').on(table.workspaceId)],
)

export const collections = pgTable(
  'collections',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [unique('collections_workspace_id_slug_key').on(table.workspaceId, table.slug)],
)

export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    /**
     * The short public handle a readable URL carries (ADR-035): ten Crockford
     * base-32 characters, unique across the instance rather than within a
     * workspace, so a key resolves without one and keeps resolving if the
     * document is moved. Assigned at creation and never changed; the UUID
     * remains the primary key.
     */
    shortId: text('short_id').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    collectionId: text('collection_id').references(() => collections.id, { onDelete: 'set null' }),
    /**
     * The document this one nests under. The foreign key is what stops a
     * PATCH writing a parent that does not exist: an unresolvable parent
     * makes every later scope-chain walk fail, including the PATCH that would
     * undo it (ADR-012). Deleting a parent lifts its children to the
     * collection root rather than deleting them with it.
     */
    parentId: text('parent_id'),
    slug: text('slug').notNull(),
    path: text('path').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull(),
    templateId: text('template_id'),
    templateVersion: integer('template_version'),
    /** The revision this document was last published at (ADR-015). */
    headRevision: text('head_revision'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('documents_workspace_id_path_key').on(table.workspaceId, table.path),
    unique('documents_short_id_key').on(table.shortId),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'documents_parent_id_fk',
    }).onDelete('set null'),
  ],
)

/** One row per document. `draft_version` increments on every accepted write (ADR-021). */
export const drafts = pgTable('drafts', {
  documentId: text('document_id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  draftVersion: integer('draft_version').notNull().default(0),
  baseRevision: text('base_revision'),
  ast: jsonb('ast').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

/**
 * One row per document. Acquire/heartbeat/release/takeover all operate on
 * this table exactly as validated by research R5 (see infrastructure/repositories/lock-repository.ts).
 */
export const documentLocks = pgTable('document_locks', {
  documentId: text('document_id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  holderUserId: text('holder_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /**
   * The session holding the lock. Revoking a session releases its locks with
   * it: a signed-out or rotated session cannot heartbeat, so without the
   * cascade its lock would sit there for a full TTL blocking everybody else
   * (ADR-021).
   */
  holderSessionId: text('holder_session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const revisionsIndex = pgTable(
  'revisions_index',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    revision: text('revision').notNull(),
    authorName: text('author_name').notNull(),
    authorEmail: text('author_email').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    summary: text('summary').notNull(),
    changeNote: text('change_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // History is read newest first, one document at a time (ADR-014).
    index('revisions_index_document_idx').on(table.documentId, table.timestamp),
    // A publish writes to the content store first and records here second, so
    // a retried publish must find its own row rather than add another
    // (ADR-015).
    unique('revisions_index_document_id_revision_key').on(table.documentId, table.revision),
  ],
)

/**
 * One rendered body, addressed by what it was rendered from (ADR-031).
 *
 * The key is the hash of the render input — the Markdown and the titles of the
 * documents it links to — and the render version, so a publish and a rename
 * each produce a new row and the old one simply stops being read.
 * `document_id` records which document first produced the entry and is never
 * read to decide what an entry means: two documents with the same input share
 * the row. `stale` is no longer written or read, because nothing invalidates
 * any more; the column goes in the contract step after this release (ADR-033).
 */
export const renderCache = pgTable(
  'render_cache',
  {
    key: text('key').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    renderVersion: integer('render_version').notNull(),
    content: jsonb('content').notNull(),
    stale: boolean('stale').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull(),
  },
  // Rename invalidation marks every entry of a set of documents at once.
  (table) => [index('render_cache_document_idx').on(table.documentId)],
)

/** What each document points at, so backlinks and the broken-link signal are a lookup (ADR-031). */
export const documentLinks = pgTable(
  'document_links',
  {
    id: text('id').primaryKey(),
    sourceDocumentId: text('source_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Null when the link names no document, or names one that does not exist. */
    targetDocumentId: text('target_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    url: text('url').notNull(),
    text: text('text').notNull(),
    kind: text('kind').notNull(),
  },
  (table) => [
    index('document_links_source_idx').on(table.sourceDocumentId),
    // Backlinks, and the documents a rename must mark for re-render.
    index('document_links_target_idx').on(table.targetDocumentId),
  ],
)

/**
 * A token mapped to a grant (plan section 14; ADR-011).
 *
 * Only `token_hash` is ever stored, so a database read yields nothing a
 * browser can replay, and it is unique because the hash is how a presented
 * token is looked up. `scope` is `document` or `subtree` — what the link
 * reaches below `document_id` — which is why the link is not simply a row in
 * `grants`: a grant at a document is inherited by everything under it, and a
 * document-scoped link must not be.
 *
 * `scope_kind`, `scope_id` and `password_hash` are the placeholder columns
 * the first migration shipped before share links were built. They are no
 * longer written or read; they go in the contract step after this release,
 * exactly as `render_cache.stale` does (ADR-033). A link's optional password
 * arrives with the comment and edit roles in M7 and will use a fresh column
 * hashed by the current password scheme.
 */
export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    role: text('role').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    /** Stamped on every use, so "when was this last followed" costs no audit scan. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    scopeKind: text('scope_kind'),
    scopeId: text('scope_id'),
    passwordHash: text('password_hash'),
  },
  // Listing the links on a document is what the share dialog opens with.
  (table) => [index('share_links_document_idx').on(table.documentId)],
)

export const commentThreads = pgTable('comment_threads', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  selector: jsonb('selector').notNull(),
  revisionHash: text('revision_hash'),
  status: text('status').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const comments = pgTable('comments', {
  id: text('id').primaryKey(),
  threadId: text('thread_id')
    .notNull()
    .references(() => commentThreads.id, { onDelete: 'cascade' }),
  authorId: text('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
})

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

/** Written in the same transaction as the change it reports (plan §22). */
export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  /**
   * Set when an event has failed too many times to be worth retrying
   * (`MAX_OUTBOX_ATTEMPTS`). A dead-lettered event is never claimed again and
   * keeps its last error, so a backlog of failures is a query rather than a
   * log nobody reads.
   */
  deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
})

/**
 * A `tsvector`, which Postgres has and Drizzle does not name.
 *
 * Declared here rather than reached for with raw SQL at every use so the
 * generated column below, the GIN index on it, and the query that reads it
 * all agree on one type.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector'
  },
})

/**
 * The search index (ADR-010, plan §15): one row per published document,
 * derived from its published Markdown and rebuildable from the content store
 * by `quill reindex`, which is what makes it an index and not a system of
 * record (ADR-034).
 *
 * `document_id` is both the primary key and a cascading foreign key, which is
 * how a deleted document leaves the index: there is no `DocumentDeleted`
 * event to consume, and adding one to do what the database already does on
 * the same transaction would be a second, slower way to be wrong.
 *
 * The three weighted columns are ADR-010's: the title is weight A, the
 * headings B, the body C, combined into one stored `tsvector` so the GIN
 * index covers all three and a query ranks across them in one pass. Weighting
 * happens in the generated expression rather than in the query, because a
 * generated column is recomputed by Postgres on every write and can never
 * fall out of step with the text it was built from. `headings` holds each
 * heading repeated by its depth weight (`headingWeight`), which is how the
 * per-heading weighting `IndexableHeading` carries reaches a `tsvector` that
 * only has one weight letter for the whole column.
 *
 * `revision` and `index_version` record what the row was derived from
 * (ADR-034), so a partial rebuild is always safe and a later projection
 * version can be told from this one.
 */
export const documentSearch = pgTable(
  'document_search',
  {
    documentId: text('document_id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    collectionId: text('collection_id').references(() => collections.id, { onDelete: 'set null' }),
    path: text('path').notNull(),
    title: text('title').notNull(),
    /** Each heading repeated by its depth weight, so an `h1` outranks an `h6` within weight B. */
    headings: text('headings').notNull(),
    body: text('body').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    owners: text('owners')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text('status').notNull(),
    /** The document's own last update, which the recency boost decays from. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    /** The revision this row was projected from (ADR-034). Null for a row rebuilt from a workspace with no revision recorded. */
    revision: text('revision'),
    /** `INDEXABLE_DOCUMENT_VERSION` at the time of writing (ADR-033). */
    indexVersion: integer('index_version').notNull().default(1),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("headings", '')), 'B') || setweight(to_tsvector('english', coalesce("body", '')), 'C')`,
    ),
  },
  (table) => [
    index('document_search_vector_idx').using('gin', table.searchVector),
    // Every query is scoped to the workspaces a caller may read (ADR-012).
    index('document_search_workspace_idx').on(table.workspaceId),
    // `collection:` filters, and the rebuild of one collection.
    index('document_search_collection_idx').on(table.collectionId),
    // `tag:` and `owner:` filters are array containment, which GIN answers.
    index('document_search_tags_idx').using('gin', table.tags),
    index('document_search_owners_idx').using('gin', table.owners),
  ],
)
