import fastifyHelmet from '@fastify/helmet'
import type { FastifyInstance } from 'fastify'

/**
 * The response headers ADR-011 requires, via `@fastify/helmet`.
 *
 * The CSP is strict and nonce-based: `enableCSPNonces` mints one nonce per
 * response, appends `'nonce-…'` to `script-src` and `style-src`, and exposes
 * it as `reply.cspNonce` so any HTML this server renders can carry it. There
 * is no `unsafe-inline` and no `unsafe-eval` anywhere, so an injected
 * `<script>` has no way to execute even if one ever reaches the page.
 */

export interface SecurityHeaderOptions {
  /** From `config.https`: HSTS is only meaningful, and only honest, behind TLS. */
  readonly https: boolean
  /**
   * From `config.serveApiDocs`, which is false in production. The Swagger UI
   * bundle needs inline script and style, so it — and only it, and only when
   * the docs are served at all — is served a relaxed policy.
   */
  readonly serveApiDocs: boolean
}

/** Two years, the value the HSTS preload list requires. */
const HSTS_MAX_AGE_SECONDS = 63_072_000

const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()'

const API_DOCS_PREFIX = '/api/docs'

/** Enough for the Swagger UI bundle, which inlines its own boot script and styles. */
const API_DOCS_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"

export function registerSecurityHeaders(
  app: FastifyInstance,
  options: SecurityHeaderOptions,
): void {
  app.register(fastifyHelmet, {
    enableCSPNonces: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'media-src': ["'self'"],
        'manifest-src': ["'self'"],
        'worker-src': ["'self'"],
        'frame-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
    },
    // Long-lived and subdomain-wide, but only where the app knows it is
    // behind TLS: asserting HSTS from a plain-http instance would pin a
    // scheme that instance cannot serve.
    hsts: options.https
      ? { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    // Third-party embeds (ADR-009) run in sandboxed iframes; COEP would
    // block them outright, which is a product decision this ADR does not make.
    crossOriginEmbedderPolicy: false,
    xFrameOptions: { action: 'deny' },
  })

  app.addHook('onSend', async (request, reply) => {
    reply.header('Permissions-Policy', PERMISSIONS_POLICY)
    if (options.serveApiDocs && request.url.startsWith(API_DOCS_PREFIX)) {
      reply.header('Content-Security-Policy', API_DOCS_CSP)
    }
  })
}
