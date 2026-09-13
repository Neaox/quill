import { toApiError } from './errors.ts'

/**
 * The shape every `ApiClient` method (`client.GET`, `.POST`, ...) resolves
 * to, parameterised by the response type the generated client declares.
 */
export interface FetchResult<T> {
  readonly data?: T | undefined
  readonly error?: unknown
  readonly response: Response
}

/**
 * Unwraps an `openapi-fetch` call into its data, or throws a typed
 * `ApiError`.
 *
 * The response-typing workaround this used to carry is gone: the server now
 * declares response schemas for the content routes, so `T` is *inferred*
 * from the generated client at every call site that reads one
 * (`documents.ts`, `content.ts`, `publishing.ts`). The routes still declared
 * `content?: never` in `packages/api-client/src/schema.gen.d.ts` — the M1
 * draft, lock, and auth routes, whose TypeBox schemas describe their request
 * but not their reply — infer `undefined` there and so name the DTO
 * explicitly instead; `undefined` is assignable to `T | undefined`, which is
 * what makes both spellings type-check through one function. That is the
 * whole of the remaining gap, and it shrinks to nothing the moment those
 * routes gain response schemas.
 *
 * The single assertion left is `data as T` on a successful response: a 2xx
 * body is present by construction, which the generated optionality cannot
 * express.
 */
export async function request<T>(call: Promise<FetchResult<T>>): Promise<T> {
  const { data, error, response } = await call
  if (!response.ok) {
    throw toApiError(response.status, error)
  }
  return data as T
}
