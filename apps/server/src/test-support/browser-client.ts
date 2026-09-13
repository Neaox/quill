import type { FastifyInstance } from 'fastify'

/**
 * Makes `app.inject` behave like a browser for the CSRF hook
 * (`plugins/csrf.ts`).
 *
 * The hook's policy is that a state-changing request carrying a session
 * cookie but no fetch metadata is not a browser and is refused. Every
 * integration test here *is* that request, so rather than repeating the
 * header in a hundred call sites, the harness states once that its client is
 * a same-origin browser. A test that wants the other answer passes its own
 * `sec-fetch-site` or `origin` header, which still wins — the default only
 * fills a gap.
 */
export function injectAsBrowser(app: FastifyInstance): void {
  const inject = app.inject.bind(app) as FastifyInstance['inject']
  app.inject = ((options: { headers?: Record<string, unknown> }) =>
    inject({
      ...options,
      headers: { 'sec-fetch-site': 'same-origin', ...options.headers },
    } as never)) as FastifyInstance['inject']
}
