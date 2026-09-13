/**
 * Every route failure the application layer raises deliberately is an
 * `AppError`, mapped by the error handler (`plugins/error-handler.ts`) to
 * the consistent shape `{ error: { code, message, details? } }`.
 */
export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function unauthenticated(message = 'Sign in required'): AppError {
  return new AppError(401, 'unauthenticated', message)
}

/** Distinct from `unauthenticated` so a client can tell "never signed in" from "was signed in, lapsed" (ADR-021's `session_expired`). */
export function sessionExpired(): AppError {
  return new AppError(401, 'session_expired', 'Your session has expired, please sign in again')
}

export function forbidden(message = 'Not allowed'): AppError {
  return new AppError(403, 'forbidden', message)
}

export function notFound(message = 'Not found'): AppError {
  return new AppError(404, 'not_found', message)
}

/**
 * The reader already holds this exact body (ADR-031's ETag on the rendered
 * route). It travels as an `AppError` so that every status code a route can
 * answer with is decided in one place; the handler sends 304 with no body.
 */
export function notModified(): AppError {
  return new AppError(304, 'not_modified', 'Not modified')
}

/**
 * The caller does not hold a valid lock on this document, so this write is not
 * the one that counts: stop autosave and enter recovery (ADR-021). The status
 * is the one the draft route already answers with, so a client branches on it
 * without caring which write it was.
 */
export function lockLost(holder: unknown): AppError {
  return new AppError(423, 'lock_lost', 'You do not hold a valid lock on this document', {
    holder,
  })
}

/** The request was well formed, but what it names cannot be processed as it stands. */
export function unprocessable(code: string, message: string, details?: unknown): AppError {
  return new AppError(422, code, message, details)
}

export function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError(409, code, message, details)
}

/**
 * The request looks like one site acting on another's behalf (ADR-011's
 * fetch-metadata and `Origin` checks). A distinct code so a client can tell
 * this from an ordinary `403`, which is about what the user may do.
 */
export function crossOriginRejected(reason: string): AppError {
  return new AppError(403, 'cross_origin_rejected', 'This request was rejected as cross-site', {
    reason,
  })
}

/** Too many attempts on this key; `retryAfterSeconds` is the current backoff window. */
export function rateLimited(retryAfterMs: number): AppError {
  return new AppError(429, 'rate_limited', 'Too many attempts. Please wait and try again.', {
    retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
  })
}

/** A verified email address is required before a user can act beyond their own profile (ADR-011). */
export function emailNotVerified(): AppError {
  return new AppError(403, 'email_not_verified', 'Verify your email address before doing this')
}
