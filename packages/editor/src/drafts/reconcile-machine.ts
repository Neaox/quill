import type { DocumentMerge } from '@quill/markdown'

import type { AutosaveStatus } from './autosave-machine.ts'
import type { DocumentAst, LoadedDraft, LockHolder } from './clients.ts'
import type { LockStatus } from './lock-machine.ts'

/**
 * Bringing an editor that fell out of step with the server back into it
 * (ADR-021, amendment of 2026-10-11), as a pure state machine.
 *
 * - `relocking`: our lock lapsed or was refused; it is being taken again.
 * - `waiting`: somebody else holds the lock. Our changes are kept, and the
 *   lock is asked for again until it frees.
 * - `merging`: the server's draft is being read and merged with ours.
 * - `conflicted`: some of the two overlap; the author resolves them, block
 *   by block. Until then nothing is sent, and the edit and its base stay in
 *   the recovery store.
 * - `failed`: the server's draft could not be read; it is tried again.
 */
export type ReconcilePhase =
  | { readonly status: 'idle' }
  | { readonly status: 'relocking' }
  | { readonly status: 'waiting'; readonly holder: LockHolder | null }
  | { readonly status: 'merging' }
  | {
      readonly status: 'conflicted'
      readonly merge: DocumentMerge
      readonly theirs: LoadedDraft
      readonly mine: DocumentAst
    }
  | { readonly status: 'failed'; readonly reason: string }

export type ReconcileStatus = ReconcilePhase['status']

export type ReconcileEvent =
  | { readonly type: 'relock-started' }
  | { readonly type: 'waiting'; readonly holder: LockHolder | null }
  | { readonly type: 'merge-started' }
  | {
      readonly type: 'conflicted'
      readonly merge: DocumentMerge
      readonly theirs: LoadedDraft
      readonly mine: DocumentAst
    }
  | { readonly type: 'failed'; readonly reason: string }
  | { readonly type: 'settled' }

export const IDLE: ReconcilePhase = { status: 'idle' }

export function reconcileReducer(phase: ReconcilePhase, event: ReconcileEvent): ReconcilePhase {
  switch (event.type) {
    case 'relock-started':
      return { status: 'relocking' }
    case 'waiting':
      return { status: 'waiting', holder: event.holder }
    case 'merge-started':
      return phase.status === 'merging' ? phase : { status: 'merging' }
    case 'conflicted':
      return { status: 'conflicted', merge: event.merge, theirs: event.theirs, mine: event.mine }
    case 'failed':
      return { status: 'failed', reason: event.reason }
    case 'settled':
      return phase.status === 'idle' ? phase : IDLE
  }
}

/** What the session needs to get back in step, from where the lock and autosave stand. */
export type ReconcileNeed = 'none' | 'relock' | 'wait' | 'merge'

export function reconcileNeed(
  lock: LockStatus,
  autosave: AutosaveStatus,
  unsaved: boolean,
): ReconcileNeed {
  // Somebody else's lock comes first: taking it again would only be refused.
  if (lock === 'held_by_other') return unsaved ? 'wait' : 'none'
  // The server holds a newer draft than ours: merge, whatever else is true.
  if (autosave === 'conflict') return 'merge'
  // Our lock lapsed or was let go while we were away (a heartbeat said so), or
  // a save was refused for want of one.
  if (lock === 'lost' || lock === 'released' || autosave === 'blocked') return 'relock'
  return 'none'
}
