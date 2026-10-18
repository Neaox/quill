import type { DocumentId, RevisionId, UserId } from '@quill/domain'

import type { DocumentLockRow, DraftRow, SessionId } from '../ports/persistence.ts'
import type { Clock } from '../ports/system.ts'
import { heldByAnother, readDraftContent } from './publish-document.ts'
import { revertDraftChanges } from './revert-draft-changes.ts'
import type {
  RevertDraftChangesDependencies,
  RevertDraftChangesResult,
} from './revert-draft-changes.ts'
import { stampDraftAuthorship } from './stamp-draft-authorship.ts'

/**
 * Putting some of what changed since the published page back in the draft, from outside
 * the editor (a command): the comparison of the published page with the draft offers it
 * change by change.
 *
 * `revertDraftChanges` works out the draft with the changes put back; this saves it. A
 * draft is written by whoever holds its lock (ADR-021), and the comparison page holds none,
 * so this is written the way a rename is: refused while another session is editing, and
 * bumping the version, so an editor of this session open elsewhere is told its next write is
 * stale and reads the draft again. The draft as it was comes back with the answer, so the
 * caller can offer to undo it (`replaceDraftContent`).
 */

export type PutBackDraftChangesDependencies = RevertDraftChangesDependencies &
  Readonly<{ clock: Clock }>

export interface ReplaceDraftContentCommand {
  readonly documentId: DocumentId
  /** The session asking: a write re-validates the lock (ADR-021). */
  readonly sessionId: SessionId
  /** Whose name the blocks this write adds or edits will carry. */
  readonly userId: UserId
  /** The version of the draft the caller is replacing. */
  readonly draftVersion: number
  /** The draft's new content, as a draft row holds it. */
  readonly ast: unknown
}

export type ReplaceDraftContentResult =
  | {
      readonly kind: 'replaced'
      readonly draft: DraftRow
      /** The content the draft held before, which undoing the write puts back. */
      readonly previous: unknown
    }
  | { readonly kind: 'stale'; readonly currentVersion: number }
  | { readonly kind: 'lock-lost'; readonly holder: DocumentLockRow }
  | { readonly kind: 'no-draft'; readonly documentId: DocumentId }
  | { readonly kind: 'unreadable' }

/**
 * The draft's content replaced, while nobody else is editing it and it is still the version
 * the caller saw. What the write changed is stamped with who made it, as a save is.
 */
export async function replaceDraftContent(
  deps: Pick<PutBackDraftChangesDependencies, 'uow' | 'format' | 'clock'>,
  command: ReplaceDraftContentCommand,
): Promise<ReplaceDraftContentResult> {
  if (readDraftContent(command.ast) === null) return { kind: 'unreadable' }
  const now = deps.clock.now()
  return deps.uow.run(async (tx): Promise<ReplaceDraftContentResult> => {
    const holder = await heldByAnother(tx, command.documentId, command.sessionId, now)
    if (holder !== null) return { kind: 'lock-lost', holder }
    const draft = await tx.drafts.find(command.documentId)
    if (draft === null) return { kind: 'no-draft', documentId: command.documentId }
    if (draft.draftVersion !== command.draftVersion) {
      return { kind: 'stale', currentVersion: draft.draftVersion }
    }
    const authorship = stampDraftAuthorship(deps.format, draft, command.ast, {
      by: command.userId,
      at: now,
    })
    const written = await tx.drafts.rebase({
      documentId: command.documentId,
      baseRevision: draft.baseRevision,
      ast: command.ast,
      ...(authorship === undefined ? {} : { authorship }),
      expectedVersion: draft.draftVersion,
      now,
    })
    /* v8 ignore next -- only a write between the read and this one, inside one transaction. */
    if (written === null) return { kind: 'stale', currentVersion: draft.draftVersion + 1 }
    return { kind: 'replaced', draft: written, previous: draft.ast }
  })
}

export interface PutBackDraftChangesCommand {
  readonly documentId: DocumentId
  readonly sessionId: SessionId
  readonly userId: UserId
  /** The revision the changes are since: the published page. */
  readonly from: RevisionId | null
  /** The version of the draft the caller compared. */
  readonly draftVersion: number
  /** The ids of the changes, as the comparison named them. */
  readonly changes: readonly string[]
  readonly appOrigins?: readonly string[] | undefined
}

export type PutBackDraftChangesResult =
  | Exclude<RevertDraftChangesResult, { readonly kind: 'reverted' }>
  | Exclude<ReplaceDraftContentResult, { readonly kind: 'unreadable' }>

export async function putBackDraftChanges(
  deps: PutBackDraftChangesDependencies,
  command: PutBackDraftChangesCommand,
): Promise<PutBackDraftChangesResult> {
  const reverted = await revertDraftChanges(deps, command)
  if (reverted.kind !== 'reverted') return reverted
  const written = await replaceDraftContent(deps, {
    documentId: command.documentId,
    sessionId: command.sessionId,
    userId: command.userId,
    draftVersion: reverted.draftVersion,
    ast: reverted.content,
  })
  /* v8 ignore next -- the format hands back the draft it was given, which was readable. */
  if (written.kind === 'unreadable') return { kind: 'no-draft', documentId: command.documentId }
  return written
}
