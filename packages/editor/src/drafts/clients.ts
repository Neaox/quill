import type { DocumentAst } from '../document-ast.ts'

export type { DocumentAst }

/** Who holds a document, as the server reports it for recovery copy. */
export interface LockHolder {
  readonly userId: string
  readonly displayName: string
  readonly expiresAt: number
}

/** The lock this client holds, as returned by acquire and takeover. */
export interface Lock {
  readonly holderUserId: string
  readonly holderSessionId: string
  readonly expiresAt: number
}

/** `POST /lock/acquire`: 200 `acquired`, 409 `held`. */
export type AcquireResult =
  | { readonly status: 'acquired'; readonly lock: Lock }
  | { readonly status: 'held'; readonly holder: LockHolder }

/**
 * `POST /lock/heartbeat`: 200 `alive`, 410 `expired` (our own lock lapsed and is
 * free again), 409 `taken_over`, 404 `released`. R5 finding: expiry is evaluated
 * independently of takeover, so `expired` can arrive while we are still the holder.
 */
export type HeartbeatResult =
  | { readonly status: 'alive'; readonly expiresAt: number }
  | { readonly status: 'expired' }
  | { readonly status: 'taken_over'; readonly holder: LockHolder }
  | { readonly status: 'released' }

/** `POST /lock/takeover`: 200 `acquired`, 403 `forbidden` for non-admins. */
export type TakeoverResult =
  | { readonly status: 'acquired'; readonly lock: Lock }
  | { readonly status: 'forbidden' }

/** The lock endpoints of ADR-021, bound to one document and one session. */
export interface LockClient {
  acquire(): Promise<AcquireResult>
  heartbeat(): Promise<HeartbeatResult>
  /** `DELETE /lock` answers 204 unconditionally, so this cannot fail. */
  release(): Promise<void>
  takeover(): Promise<TakeoverResult>
}

/**
 * `PUT /draft`: 200 `saved`, 409 `stale_version` (we hold the lock but our version
 * is behind — re-read and retry), 423 `lock_lost` (stop and recover), 401
 * `session_expired`. The two conflict cases are deliberately distinct: one is
 * recoverable in place, the other is not.
 */
export type DraftSaveResult =
  | { readonly status: 'saved'; readonly draftVersion: number; readonly updatedAt: number }
  | { readonly status: 'stale_version'; readonly currentVersion: number }
  | { readonly status: 'lock_lost'; readonly holder: LockHolder | null }
  | { readonly status: 'session_expired' }

/** A draft as read back from the server. */
export interface LoadedDraft {
  readonly ast: DocumentAst
  readonly draftVersion: number
  readonly baseRevision: string | null
}

/** The draft endpoints of ADR-021, bound to one document. */
export interface DraftClient {
  load(): Promise<LoadedDraft>
  save(ast: DocumentAst, expectedVersion: number): Promise<DraftSaveResult>
}
