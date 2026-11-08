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
 */
export type WorkspaceOrigin = { readonly kind: 'native' } | { readonly kind: 'sourced' }

export const NATIVE_ORIGIN: WorkspaceOrigin = { kind: 'native' }

export const SOURCED_ORIGIN: WorkspaceOrigin = { kind: 'sourced' }
