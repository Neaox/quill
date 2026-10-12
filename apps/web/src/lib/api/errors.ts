/**
 * The typed shape of every server error, and the mapper from the wire
 * envelope to it.
 *
 * Every failure the server raises deliberately (`apps/server/src/errors.ts`)
 * and every failure Fastify raises itself (validation, 404, 500) is sent as
 * `{ error: { code, message, details? } }`
 * (`apps/server/src/plugins/error-handler.ts`). `ApiError` is that shape as a
 * real `Error`, so a hook can `throw` or reject with it and a caller can
 * branch on `status`/`code` without re-parsing a response body.
 */
export interface ApiErrorBody {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  /** The response's `Retry-After`, in milliseconds, when it sent one. */
  readonly retryAfterMs: number | null

  constructor(status: number, body: ApiErrorBody, retryAfterMs: number | null = null) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.details = body.details
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * `Retry-After` is either a number of seconds or an HTTP date (RFC 9110
 * section 10.2.3). Anything else is ignored rather than guessed at.
 */
function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? null : Math.max(0, date - now)
}

/**
 * The statuses a retry can fix: rate limiting and a gateway or server that is
 * restarting or overloaded. Every other status is the server's answer, and
 * asking again gets the same one.
 */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504])

/**
 * Whether a failed request is worth sending again. `fetch` rejects with a
 * `TypeError` when the request never reached a server at all (offline, DNS,
 * a refused connection), which is the most transient failure there is.
 */
export function isTransientFailure(error: unknown): boolean {
  if (error instanceof ApiError) return TRANSIENT_STATUSES.has(error.status)
  return error instanceof TypeError
}

/** How long the server asked us to wait, when the failure is one of its answers. */
export function retryAfterOf(error: unknown): number | null {
  return error instanceof ApiError ? error.retryAfterMs : null
}

function hasErrorEnvelope(value: unknown): value is { error: ApiErrorBody } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'object' &&
    (value as { error?: unknown }).error !== null
  )
}

/**
 * Maps a failed response's status and parsed body to an `ApiError`. Falls
 * back to a generic error rather than throwing itself: a body that does not
 * match the envelope (a proxy error page, a network tool's own failure) is
 * still something the caller can display.
 */
export function toApiError(
  status: number,
  body: unknown,
  headers?: Headers,
  now: () => number = Date.now,
): ApiError {
  const retryAfter = parseRetryAfter(headers?.get('retry-after') ?? null, now())
  if (hasErrorEnvelope(body)) {
    return new ApiError(status, body.error, retryAfter)
  }
  return new ApiError(
    status,
    { code: 'unknown_error', message: `Request failed with status ${status}` },
    retryAfter,
  )
}
