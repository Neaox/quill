import createClient, { type Client } from 'openapi-fetch'

import type { paths } from './schema.gen.d.ts'

export type { components, paths } from './schema.gen.d.ts'

/**
 * The web app's only way to talk to the server (ADR-013). `paths` is generated
 * from the server's OpenAPI description by `pnpm --filter @quill/api-client
 * generate`, so a route change that is not additive fails to type-check here
 * before it can reach a screen.
 */
export type ApiClient = Client<paths>

export interface ApiClientOptions {
  /** Origin of the API; empty for same-origin requests through the dev proxy. */
  readonly baseUrl?: string
  /** Injected for tests and for server-side rendering. */
  readonly fetch?: typeof fetch
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  return createClient<paths>({
    baseUrl: options.baseUrl ?? '',
    credentials: 'include',
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })
}
