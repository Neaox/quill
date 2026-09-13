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

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.details = body.details
  }
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
export function toApiError(status: number, body: unknown): ApiError {
  if (hasErrorEnvelope(body)) {
    return new ApiError(status, body.error)
  }
  return new ApiError(status, {
    code: 'unknown_error',
    message: `Request failed with status ${status}`,
  })
}
