/**
 * Where a workspace's content comes from (ADR-061).
 *
 * A **native** workspace is written in Quill, and is what every workspace is
 * unless it says otherwise. A **sourced** workspace reads its documents from
 * an external Git repository: its sync job is the only writer of its content,
 * so nothing a person does may change it (`narrowByOrigin`).
 *
 * A discriminated union rather than a flag, so that the source a sourced
 * workspace reads from can join its variant without touching native ones.
 *
 * A workspace whose source was **disconnected** is native, written in Quill
 * like any other, and says so (`disconnected`): it keeps the record of the
 * repository it was read from, which its stored links still resolve through
 * (ADR-061, amendment of 11 November 2026).
 */
export type WorkspaceOrigin =
  | { readonly kind: 'native'; readonly disconnected?: boolean }
  | { readonly kind: 'sourced' }

export const NATIVE_ORIGIN: WorkspaceOrigin = { kind: 'native' }

export const DISCONNECTED_ORIGIN: WorkspaceOrigin = { kind: 'native', disconnected: true }

/**
 * Whether the workspace has a repository's record: it reads from one now, or
 * did until it was disconnected. Its stored text was written against the
 * repository, so its links are drawn through the record either way.
 */
export function hasSourceRecord(origin: WorkspaceOrigin): boolean {
  return origin.kind === 'sourced' || origin.disconnected === true
}

export const SOURCED_ORIGIN: WorkspaceOrigin = { kind: 'sourced' }
