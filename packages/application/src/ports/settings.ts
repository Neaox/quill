import type { RevisionId, WorkspaceId } from '@quill/domain'

import type { OrganisationSettings, WorkspaceSettings } from '../settings/documents.ts'
import type { ContentAuthor } from './content-store.ts'

/**
 * The settings store (ADR-034).
 *
 * Settings are versioned files in a **system workspace** of the content
 * store, written through the same path documents are, so every change is a
 * revision with an author and a change note, an instance moves by copying
 * files, and two servers writing at once are separated by a compare-and-swap
 * rather than by luck. The adapter behind this port does the YAML and the
 * content store; nothing above it knows either exists.
 *
 * Read answers with the revision it read at, and a write states the revision
 * it was based on. That pair is the compare-and-swap: a write whose
 * expectation no longer holds comes back as `conflict` carrying what the file
 * says now, and never as a silent merge — two administrators' versions of a
 * policy are not something to blend (ADR-014 merges *documents*, for good
 * reasons that do not apply here).
 */

export type SettingsRead<T> =
  | { readonly kind: 'settings'; readonly document: T; readonly revision: RevisionId }
  /** No file yet: the caller uses the defaults. */
  | { readonly kind: 'unset' }
  /**
   * A file this release cannot read — a newer version, or a shape that fails
   * its schema. Reported rather than replaced with the defaults, because
   * overwriting an administrator's configuration with "as shipped" is the
   * most expensive way to recover from a downgrade.
   */
  | { readonly kind: 'unreadable'; readonly reason: string; readonly revision: RevisionId }

export type SettingsWrite<T> =
  | { readonly kind: 'written'; readonly document: T; readonly revision: RevisionId }
  | { readonly kind: 'conflict'; readonly current: SettingsRead<T> }

export interface WriteSettingsInput<T> {
  readonly document: T
  /** The revision the caller read, or null when it read nothing. */
  readonly expectedRevision: RevisionId | null
  readonly author: ContentAuthor
  readonly changeNote?: string
}

export interface Settings {
  readOrganisation(): Promise<SettingsRead<OrganisationSettings>>
  writeOrganisation(
    input: WriteSettingsInput<OrganisationSettings>,
  ): Promise<SettingsWrite<OrganisationSettings>>
  readWorkspace(workspaceId: WorkspaceId): Promise<SettingsRead<WorkspaceSettings>>
  writeWorkspace(
    workspaceId: WorkspaceId,
    input: WriteSettingsInput<WorkspaceSettings>,
  ): Promise<SettingsWrite<WorkspaceSettings>>
}
