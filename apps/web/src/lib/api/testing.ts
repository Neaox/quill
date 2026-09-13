import { QueryClient } from '@tanstack/react-query'

import { createApiClient, type ApiClient } from '@quill/api-client'

import type { RouterContext } from '../../app/router-context.ts'

/**
 * A fake `fetch` for component tests, built from a small route table instead
 * of a network-mocking library (the task calls for "a fake `fetch` injected
 * into `createApiClient`, no MSW needed"). A route key is `"METHOD
 * /api/path/{param}"`, matching the path syntax `@quill/api-client`'s
 * `paths` type already uses, so a test route reads like the route it fakes.
 */
export type FakeRouteHandler = (
  request: Request,
  params: Readonly<Record<string, string>>,
) => Response | Promise<Response>

export type FakeRoutes = Readonly<Record<string, FakeRouteHandler>>

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return jsonResponse(status, {
    error: { code, message, ...(details === undefined ? {} : { details }) },
  })
}

interface CompiledRoute {
  readonly method: string
  readonly pattern: RegExp
  readonly paramNames: readonly string[]
  readonly handler: FakeRouteHandler
}

function compileRoute(key: string, handler: FakeRouteHandler): CompiledRoute {
  const [method, path] = key.split(' ', 2)
  if (method === undefined || path === undefined) {
    throw new Error(`Invalid fake route key "${key}"; expected "METHOD /path"`)
  }
  const paramNames: string[] = []
  const source = path
    .split('/')
    .map((segment) => {
      const match = /^\{(.+)\}$/.exec(segment)
      if (match?.[1] === undefined) return segment
      paramNames.push(match[1])
      return '([^/]+)'
    })
    .join('/')
  return { method, pattern: new RegExp(`^${source}$`), paramNames, handler }
}

/**
 * Builds an `ApiClient` whose requests never leave the process. Unmatched
 * requests resolve as a `404` with the server's real error envelope, so a
 * test that forgot to stub a route fails on an assertion about that body
 * rather than on a thrown network error.
 *
 * `openapi-fetch` builds its own `Request` from `baseUrl` and the schema
 * path *before* ever calling the injected `fetch` (see `coreFetch` in
 * `openapi-fetch/src/index.js`), so an empty `baseUrl` — the real client's
 * dev-proxy setting, `@quill/api-client`'s `createApiClient` default — makes
 * that internal `new Request('/api/...')` throw in a test: Node's
 * `Request`/`URL` have no page origin to resolve a relative URL against,
 * unlike a browser. A fixed dummy origin as `baseUrl` gives it one; nothing
 * in a route pattern or handler looks at which one.
 */
const FAKE_ORIGIN = 'http://fake-api.test'

export function createFakeApiClient(routes: FakeRoutes): ApiClient {
  const compiled = Object.entries(routes).map(([key, handler]) => compileRoute(key, handler))

  const fakeFetch: typeof fetch = async (input) => {
    // Always a `Request` in practice — `openapi-fetch` never calls `fetch`
    // with a bare string or `URL` — but every shape `typeof fetch` allows is
    // still handled, so this stays correct if that internal ever changes.
    const request = input instanceof Request ? input : new Request(input)
    const url = new URL(request.url)

    for (const route of compiled) {
      if (route.method !== request.method) continue
      const match = route.pattern.exec(url.pathname)
      if (match === null) continue
      const params = Object.fromEntries(
        route.paramNames.map((name, index) => [name, match[index + 1] ?? '']),
      )
      return route.handler(request, params)
    }

    return errorResponse(404, 'not_found', `No fake route for ${request.method} ${url.pathname}`)
  }

  return createApiClient({ baseUrl: FAKE_ORIGIN, fetch: fakeFetch })
}

/**
 * A `RouterContext` for tests that mount `routeTree` directly (the pattern
 * `home-page.test.tsx` established): a fresh `QueryClient` per test, and a
 * fake `ApiClient` — empty by default, since most such tests exercise
 * routes that never call `beforeLoad`'s `me` fetch.
 */
export function createTestRouterContext(routes: FakeRoutes = {}): RouterContext {
  return {
    queryClient: new QueryClient(),
    apiClient: createFakeApiClient(routes),
  }
}
