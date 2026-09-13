export interface LockRow {
  document_id: string
  holder_user_id: string
  holder_session_id: string
  acquired_at: Date
  last_heartbeat_at: Date
  expires_at: Date
}

export interface DraftRow {
  document_id: string
  draft_version: number
  base_revision: string | null
  ast: unknown
  updated_at: Date
}

export type AcquireResult =
  | { ok: true; lock: LockRow }
  | { ok: false; reason: 'held'; holder: LockRow }

export type HeartbeatResult =
  | { ok: true; lock: LockRow }
  | { ok: false; reason: 'expired'; holder: LockRow }
  | { ok: false; reason: 'taken_over'; holder: LockRow }
  | { ok: false; reason: 'released' }

export type ReleaseResult = { ok: true } | { ok: false; reason: 'not_holder' }

export type TakeoverResult = { ok: true; lock: LockRow }

export type WriteDraftResult =
  | { ok: true; draft: DraftRow }
  | { ok: false; reason: 'lock_lost'; holder: LockRow | null }
  | { ok: false; reason: 'stale_version'; currentVersion: number }
  | { ok: false; reason: 'not_found' }
