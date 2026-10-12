import type { DocumentId, RevisionId } from '@quill/domain'

import type { ContentStore } from '../ports/content-store.ts'
import type { DocumentFormat, DraftContent } from '../ports/document-format.ts'
import type { UnitOfWork } from '../ports/persistence.ts'
import type { Hasher } from '../ports/system.ts'
import type { BlobStore } from '../ports/blob-store.ts'
import type { Settings } from '../ports/settings.ts'
import type { CompareRevisionsDependencies } from './compare-revisions.ts'
import { compareSides, readSides } from './compare-revisions.ts'
import type { CompareRevisionsCommand } from './compare-revisions.ts'

/**
 * Putting some of what changed since a revision back in the draft (a command).
 *
 * The answer is the draft as it would then be, not a write: the person asking has the
 * draft open in an editor, and the change goes in there, where it can be undone and is
 * saved like anything else they type. It is worked out against the draft as it is
 * saved, so the caller names the version it is looking at, and is told when that is no
 * longer the draft.
 */

export type RevertDraftChangesDependencies = CompareRevisionsDependencies &
  Readonly<{
    uow: UnitOfWork
    contentStore: ContentStore
    format: DocumentFormat
    hasher: Hasher
    blobStore: BlobStore
    settings: Settings
  }>

export interface RevertDraftChangesCommand {
  readonly documentId: DocumentId
  /** The revision the changes are since: the published page. */
  readonly from: RevisionId | null
  /** The version of the draft the caller is looking at. */
  readonly draftVersion: number
  /** The ids of the changes, as the comparison named them. */
  readonly changes: readonly string[]
}

export type RevertDraftChangesResult =
  | {
      readonly kind: 'reverted'
      readonly draftVersion: number
      readonly content: DraftContent
    }
  | { readonly kind: 'stale'; readonly currentVersion: number }
  | { readonly kind: 'not-revertible'; readonly changes: readonly string[] }
  | { readonly kind: 'not-found'; readonly documentId: DocumentId }
  | { readonly kind: 'revision-not-found'; readonly revision: RevisionId }
  | { readonly kind: 'no-draft'; readonly documentId: DocumentId }

export async function revertDraftChanges(
  deps: RevertDraftChangesDependencies,
  command: RevertDraftChangesCommand,
): Promise<RevertDraftChangesResult> {
  const sides = await readSides(deps, {
    documentId: command.documentId,
    from: command.from,
    to: 'draft',
  })
  if (sides.kind !== 'sides') return sides
  /* v8 ignore next -- the newer side is the draft, which carries its content. */
  if (sides.draft === undefined) return { kind: 'no-draft', documentId: command.documentId }
  if (sides.draft.version !== command.draftVersion) {
    return { kind: 'stale', currentVersion: sides.draft.version }
  }

  const compared = await compareSides(deps, sides, { patches: true })
  /* v8 ignore next -- no key is held, so nothing is "not modified". */
  if (compared.kind !== 'compared') return { kind: 'stale', currentVersion: sides.draft.version }
  const revertible = new Set(
    compared.content.changes.filter(({ revertible: can }) => can === true).map(({ id }) => id),
  )
  const refused = command.changes.filter((id) => !revertible.has(id))
  if (refused.length > 0) return { kind: 'not-revertible', changes: refused }

  const content = deps.format.revert({
    before: sides.before,
    after: sides.after,
    draft: sides.draft.content,
    changes: command.changes,
  })
  return { kind: 'reverted', draftVersion: sides.draft.version, content }
}

export type { CompareRevisionsCommand }
