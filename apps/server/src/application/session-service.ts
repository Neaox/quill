import type { Clock, IdGenerator, SessionId, SessionRow, UnitOfWork } from '@quill/application'
import type { UserId } from '@quill/domain'

import { generateSessionToken, hashesMatch, hashSessionToken } from '../auth/session-token.ts'
import type { SessionConfig } from '../config.ts'

/**
 * The whole life of a server-side session (ADR-011).
 *
 * A session is a row plus a 256-bit token that only ever exists in the
 * cookie and in this module; the row stores the token's SHA-256. Two clocks
 * bound it — an absolute lifetime from issue, and an idle lifetime from the
 * last request — and both are enforced here, on the server, because the
 * cookie's own expiry is a client-side courtesy the client can edit.
 *
 * Rotation is issuing a new token and dropping the old row. It happens on
 * sign-in, on password change, on reset, and on any privilege change, so a
 * token captured before one of those moments is worthless after it.
 */

export interface IssuedSession {
  /** The raw token for the cookie. Never stored, never logged. */
  readonly token: string
  readonly session: SessionRow
}

export type SessionAuthentication =
  | { readonly ok: true; readonly session: SessionRow }
  | { readonly ok: false; readonly reason: 'unknown' }
  | { readonly ok: false; readonly reason: 'expired' }

export interface SessionServiceDeps {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly session: SessionConfig
}

/**
 * How stale `last_seen_at` is allowed to get before a request pays for an
 * UPDATE. The idle window is measured in days, so a minute of imprecision
 * costs nothing and saves a write on every single authenticated request.
 */
const TOUCH_INTERVAL_MS = 60_000

export function createSessionService(deps: SessionServiceDeps) {
  const { uow, clock, ids, session: config } = deps

  function idleDeadline(row: SessionRow): number {
    // A row written before `last_seen_at` existed (expand-only migration,
    // ADR-033) measures its idle window from when it was created.
    return (row.lastSeenAt ?? row.createdAt).getTime() + config.idleTtlMs
  }

  async function issue(userId: UserId): Promise<IssuedSession> {
    const now = clock.now()
    const token = generateSessionToken()
    const session = await uow.repos.sessions.create({
      id: ids.uuid() as SessionId,
      userId,
      tokenHash: hashSessionToken(token),
      now,
      expiresAt: new Date(now.getTime() + config.ttlMs),
    })
    return { token, session }
  }

  return {
    issue,

    /**
     * Rotates: the new session is issued first, then the old row is dropped,
     * so a failure between the two leaves the user signed in rather than out.
     */
    async rotate(userId: UserId, previous: SessionId | null): Promise<IssuedSession> {
      const issued = await issue(userId)
      if (previous !== null) {
        await uow.repos.sessions.delete(previous)
      }
      return issued
    },

    async authenticate(token: string): Promise<SessionAuthentication> {
      const presented = hashSessionToken(token)
      const row = await uow.repos.sessions.findByTokenHash(presented)
      if (row === null || row.tokenHash === null || !hashesMatch(row.tokenHash, presented)) {
        /* v8 ignore next 2 -- the null/mismatch arms are unreachable through
           an indexed equality lookup; they are the belt to the braces. */
        return { ok: false, reason: 'unknown' }
      }

      const now = clock.now()
      if (row.expiresAt <= now || idleDeadline(row) <= now.getTime()) {
        // A session past either clock is gone, not merely refused: leaving
        // the row behind would let it be resurrected by a clock change.
        await uow.repos.sessions.delete(row.id)
        return { ok: false, reason: 'expired' }
      }

      if (now.getTime() - (row.lastSeenAt ?? row.createdAt).getTime() >= TOUCH_INTERVAL_MS) {
        await uow.repos.sessions.touch(row.id, now)
      }
      return { ok: true, session: row }
    },

    async list(userId: UserId): Promise<readonly SessionRow[]> {
      return uow.repos.sessions.listForUser(userId)
    },

    async revoke(sessionId: SessionId): Promise<void> {
      await uow.repos.sessions.delete(sessionId)
    },

    /** Sign out everywhere, keeping the session that asked for it when one is given. */
    async revokeAll(userId: UserId, keep: SessionId | null): Promise<void> {
      if (keep === null) {
        await uow.repos.sessions.deleteAllForUser(userId)
        return
      }
      await uow.repos.sessions.deleteAllForUserExcept(userId, keep)
    },
  }
}

export type SessionService = ReturnType<typeof createSessionService>
