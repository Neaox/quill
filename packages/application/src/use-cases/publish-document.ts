import type { DocumentId, RevisionId, UserId } from '@quill/domain'

import type { ContentStore, MergeConflict } from '../ports/content-store.ts'
import type {
  DocumentFormat,
  DraftContent,
  FormatWarning,
  FrontMatterIssue,
} from '../ports/document-format.ts'
import { DRAFT_CONTENT_VERSION } from '../ports/document-format.ts'
import type {
  DocumentLockRow,
  DocumentRow,
  RepositoryBundle,
  SessionId,
  UnitOfWork,
} from '../ports/persistence.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { canonicaliseLinks } from './canonical-links.ts'
import {
  DOCUMENT_PUBLISHED,
  DOCUMENT_RENAMED,
  EVENT_PAYLOAD_VERSION,
  type DocumentPublishedPayload,
  type DocumentRenamedPayload,
} from './events.ts'
import { createVersionedReader } from './versioned-reader.ts'

/**
 * Publish: the only write to the content store, and the only way a revision
 * is created (ADR-015).
 *
 * The draft is serialised to Markdown, authoring scaffolding is removed, and
 * the front matter is checked — checked, not enforced: an incomplete required
 * section or an invalid field is stated plainly and published anyway
 * (ADR-029). The revision the content is based on is the one the *draft*
 * records, never one the caller supplies, so the three-way merge compares what
 * the author actually edited from.
 *
 * A publish is a write, so it is gated by the lock the same way autosave is
 * (ADR-021): if someone has taken the document over, the previous holder's
 * publish is rejected rather than quietly overwriting the new holder's work.
 */

export interface PublishAuthor {
  readonly userId: UserId
  readonly name: string
  readonly email: string
}

export interface PublishDependencies {
  readonly uow: UnitOfWork
  readonly contentStore: ContentStore
  readonly format: DocumentFormat
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface PublishDocumentCommand {
  readonly documentId: DocumentId
  /**
   * The revision the caller believes the draft is based on, as an assertion
   * rather than as an instruction: it is checked against the draft's own
   * recorded base and a mismatch is refused, because a caller working from a
   * stale view of the draft must re-read before it publishes.
   */
  readonly base: RevisionId | null
  readonly changeNote?: string | undefined
  readonly author: PublishAuthor
  /** The session publishing, so the lock can be re-validated as it is for any other write. */
  readonly sessionId: SessionId
}

export interface PublishedOutcome {
  readonly kind: 'published'
  readonly revision: RevisionId
  readonly document: DocumentRow
  readonly warnings: readonly FormatWarning[]
  readonly frontMatterIssues: readonly FrontMatterIssue[]
  readonly incompleteRequiredSections: readonly string[]
}

/** Someone else holds this document's lock, so this write is not the one that counts (ADR-021). */
export interface LockLostOutcome {
  readonly kind: 'lock-lost'
  readonly holder: DocumentLockRow
}

export type PublishDocumentResult =
  | PublishedOutcome
  | LockLostOutcome
  | {
      readonly kind: 'merge-required'
      readonly current: RevisionId
      readonly conflicts: readonly MergeConflict[]
    }
  | {
      /** The caller's base is not the one the draft records; re-read and try again. */
      readonly kind: 'stale-base'
      readonly base: RevisionId | null
    }
  | { readonly kind: 'not-found'; readonly documentId: DocumentId }
  | { readonly kind: 'no-draft'; readonly documentId: DocumentId }
  | { readonly kind: 'draft-unreadable'; readonly documentId: DocumentId }

export async function publishDocument(
  deps: PublishDependencies,
  command: PublishDocumentCommand,
): Promise<PublishDocumentResult> {
  const { repos } = deps.uow
  const document = await repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'not-found', documentId: command.documentId }

  const draft = await repos.drafts.find(command.documentId)
  if (draft === null) return { kind: 'no-draft', documentId: command.documentId }

  const content = readDraftContent(draft.ast)
  if (content === null) return { kind: 'draft-unreadable', documentId: command.documentId }

  if (command.base !== draft.baseRevision) {
    return { kind: 'stale-base', base: draft.baseRevision }
  }

  // Checked here so a publish that cannot count never reaches the content
  // store, and checked again inside the transaction below, where a takeover
  // cannot interleave between the check and the write.
  const holder = await heldByAnother(repos, command.documentId, command.sessionId, deps.clock.now())
  if (holder !== null) return { kind: 'lock-lost', holder }

  const prepared = deps.format.prepareForPublish({ documentId: document.id, content })
  const title = prepared.title ?? document.title
  // A link an author pasted out of the address bar becomes the canonical
  // `/d/<uuid>` here, once, on the way into the store (ADR-035), so what the
  // store holds is always the form the link index understands.
  const markdown = await canonicaliseLinks(repos.documents, prepared.markdown)

  const result = await deps.contentStore.publish({
    workspaceId: document.workspaceId,
    changes: [{ kind: 'write', documentId: document.id, path: document.path, markdown }],
    author: { name: command.author.name, email: command.author.email },
    summary: title,
    base: draft.baseRevision,
    ...(command.changeNote === undefined ? {} : { changeNote: command.changeNote }),
  })

  if (result.kind === 'merge-required') {
    return { kind: 'merge-required', current: result.current, conflicts: result.conflicts }
  }

  const recorded = await recordPublish(deps, {
    document,
    revision: result.revision,
    title,
    summary: title,
    author: command.author,
    sessionId: command.sessionId,
    changeNote: command.changeNote ?? null,
  })
  if (!recorded.ok) return { kind: 'lock-lost', holder: recorded.holder }

  return {
    kind: 'published',
    revision: result.revision,
    document: recorded.document,
    warnings: prepared.warnings,
    frontMatterIssues: prepared.frontMatterIssues,
    incompleteRequiredSections: prepared.incompleteRequiredSections,
  }
}

/**
 * The lock held by somebody other than this session, or null.
 *
 * A document nobody is editing, and a lock that has lapsed, are both fine to
 * publish from: the rule ADR-021 states is that a takeover rejects the
 * previous holder's next write, not that a publish requires a lock the author
 * may quite reasonably have released on their way out of the editor. The
 * expiry comparison is a strict less-than, so an exact-millisecond tie is not
 * expired.
 */
export async function heldByAnother(
  repos: RepositoryBundle,
  documentId: DocumentId,
  sessionId: SessionId,
  now: Date,
): Promise<DocumentLockRow | null> {
  const lock = await repos.locks.find(documentId)
  if (lock === null || lock.holderSessionId === sessionId) return null
  return lock.expiresAt.getTime() < now.getTime() ? null : lock
}

export interface RecordPublishInput {
  readonly document: DocumentRow
  readonly revision: RevisionId
  readonly title: string
  /** What the revision did, as history shows it; the title unless the publish was something else. */
  readonly summary: string
  readonly author: PublishAuthor
  readonly sessionId: SessionId
  readonly changeNote: string | null
  /**
   * The content the draft should hold from now on, when the publish replaced
   * it — a restore (ADR-015). Absent for an ordinary publish, whose draft
   * already holds exactly what was published.
   */
  readonly draftContent?: DraftContent | undefined
}

export type RecordPublishResult =
  | { readonly ok: true; readonly document: DocumentRow }
  | { readonly ok: false; readonly holder: DocumentLockRow }

/**
 * Everything a successful publish leaves behind in Postgres.
 *
 * The lock check, the document's head and status, the revisions index row that
 * makes history a lookup rather than a walk (ADR-014), and the events are one
 * transaction, so the index and the outbox can never disagree with the
 * revision that was just created and a takeover cannot slip between the check
 * and the write. A title change emits `DocumentRenamed` as well.
 *
 * Recording is idempotent on `(documentId, revision)`: a publish whose content
 * reached the store but whose record did not can be repeated without a second
 * history entry or a second event, which is what makes the retry safe.
 */
export async function recordPublish(
  deps: PublishDependencies,
  input: RecordPublishInput,
): Promise<RecordPublishResult> {
  const now = deps.clock.now()
  const { document, revision, title } = input
  const renamed = title !== document.title

  return deps.uow.run(async (tx) => {
    const holder = await heldByAnother(tx, document.id, input.sessionId, now)
    if (holder !== null) return { ok: false, holder } satisfies RecordPublishResult

    const row = await tx.documents.update(
      document.id,
      { headRevision: revision, status: 'published', ...(renamed ? { title } : {}) },
      now,
    )

    // TODO(M3): a publish that wrote to the content store and then failed
    // here leaves the two stores disagreeing until someone republishes. The
    // reconciliation pass that walks the store and rebuilds the index —
    // `quill reindex` (ADR-034) — is what closes that window for good; this
    // guard only keeps a retry from double-recording.
    const already = await tx.revisions.findForDocument(document.id, revision)
    if (already === null) {
      await tx.revisions.append({
        id: deps.ids.uuid(),
        documentId: document.id,
        workspaceId: document.workspaceId,
        revision,
        authorName: input.author.name,
        authorEmail: input.author.email,
        timestamp: now,
        summary: input.summary,
        changeNote: input.changeNote,
        now,
      })
      const published: DocumentPublishedPayload = {
        version: EVENT_PAYLOAD_VERSION,
        documentId: document.id,
        workspaceId: document.workspaceId,
        revision,
        publishedBy: input.author.userId,
      }
      await tx.outbox.write({
        id: deps.ids.uuid(),
        type: DOCUMENT_PUBLISHED,
        payload: published,
        now,
      })

      if (renamed) {
        const event: DocumentRenamedPayload = {
          version: EVENT_PAYLOAD_VERSION,
          documentId: document.id,
          workspaceId: document.workspaceId,
          from: document.title,
          to: title,
        }
        await tx.outbox.write({ id: deps.ids.uuid(), type: DOCUMENT_RENAMED, payload: event, now })
      }
    }

    // The draft is now based on the revision this publish created, so the next
    // publish from the same draft is not spuriously stale (ADR-021), and it
    // carries what was published, so a restore is not silently undone by the
    // author's next publish (ADR-015).
    await tx.drafts.rebase({
      documentId: document.id,
      baseRevision: revision,
      now,
      ...(input.draftContent === undefined ? {} : { ast: input.draftContent }),
    })
    return { ok: true, document: row } satisfies RecordPublishResult
  })
}

/**
 * A draft row's stored content, or null when this release cannot read it.
 *
 * Drafts are a persisted format and carry a version, so a reader dispatches
 * on it rather than assuming today's shape (ADR-033).
 */
const draftReader = createVersionedReader<DraftContent>({
  [DRAFT_CONTENT_VERSION]: (value) => {
    const candidate = value as Partial<DraftContent>
    if (typeof candidate.frontMatter !== 'object' || candidate.frontMatter === null) return null
    return {
      version: DRAFT_CONTENT_VERSION,
      frontMatter: candidate.frontMatter,
      ast: candidate.ast,
    }
  },
})

export function readDraftContent(value: unknown): DraftContent | null {
  return draftReader.read(value)
}
