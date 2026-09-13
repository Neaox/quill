import fastifyCookie from '@fastify/cookie'
import fastify, { type FastifyInstance } from 'fastify'

import { AUDIT_EVENTS, createAuditRecorder, recordInBackground } from './application/audit.ts'
import type { ServerConfig, TrustProxyConfig } from './config.ts'
import type { AppDependencies } from './dependencies.ts'
import { serialiseRequest } from './plugins/logging.ts'
import { attachmentRoutes } from './routes/attachments.ts'
import { authRoutes } from './routes/auth.ts'
import { oidcAuthRoutes } from './routes/auth-oidc.ts'
import { collectionRoutes } from './routes/collections.ts'
import { documentRoutes } from './routes/documents.ts'
import { draftRoutes } from './routes/drafts.ts'
import { healthRoutes } from './routes/health.ts'
import { lockRoutes } from './routes/locks.ts'
import { meRoutes } from './routes/me.ts'
import { publicSiteRoutes } from './routes/public-site.ts'
import { searchRoutes } from './routes/search.ts'
import { shareLinkRoutes, SHARE_SCHEMAS } from './routes/share-links.ts'
import { settingsRoutes } from './routes/settings.ts'
import { unitRoutes } from './routes/units.ts'
import { workspaceRoutes } from './routes/workspaces.ts'
import { registerCsrfProtection } from './plugins/csrf.ts'
import { registerErrorHandler } from './plugins/error-handler.ts'
import { registerOpenApi } from './plugins/openapi.ts'
import { registerRateLimiting } from './plugins/rate-limit.ts'
import { createRequestIdGenerator, registerRequestIdHeader } from './plugins/request-id.ts'
import { registerSecurityHeaders } from './plugins/security-headers.ts'
import { registerSessionSupport } from './plugins/session.ts'
import { SHARED_SCHEMAS } from './routes/document-schemas.ts'

/**
 * `TRUST_PROXY` in Fastify's own vocabulary.
 *
 * A hop count becomes the predicate it means — "the request came through at
 * most this many proxies, so the address that many hops in is the client" —
 * which is how `trust proxy: 2` has always been defined. Fastify accepts a
 * number directly, but only the predicate form is in its published types,
 * and spelling the rule out here is clearer than relying on either.
 */
function toFastifyTrustProxy(
  trustProxy: TrustProxyConfig,
): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (trustProxy === false) return false
  if (typeof trustProxy === 'number') {
    const hops = trustProxy
    return (_address: string, hop: number): boolean => hop < hops
  }
  return [...trustProxy]
}

export interface AppOptions {
  readonly logLevel?: ServerConfig['logLevel'] | 'silent'
  /**
   * Everything beyond health checks needs a database, a clock, and the
   * rest — see `dependencies.ts`. Omitted, `buildApp` serves exactly the
   * health routes it always has (this is what `app.test.ts` exercises).
   */
  readonly deps?: AppDependencies
  /**
   * Serves the interactive Swagger UI. Defaults to `config.serveApiDocs`,
   * which is false in production, so a deployment never publishes its own
   * route map by accident.
   */
  readonly serveApiDocs?: boolean
}

/**
 * Build the Fastify application without starting it.
 *
 * Kept separate from `main.ts` so tests can drive the app through
 * `app.inject()` with no network and no process-level side effects, and so
 * the OpenAPI description can be exported from the routes themselves with
 * nothing behind them (`scripts/export-openapi.ts`).
 */
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const deps = options.deps
  // Nothing in front of the server is trusted unless the deployment says so
  // (`TRUST_PROXY`): `request.ip` is what the rate limiter keys on, and a
  // believed `X-Forwarded-For` from an untrusted peer is an unlimited budget.
  const trustProxy = deps?.config.trustProxy ?? false
  const app = fastify({
    logger:
      options.logLevel === 'silent'
        ? false
        : {
            level: options.logLevel ?? 'info',
            // A share link carries its token in the path, and Fastify logs
            // every request's URL: the serialiser redacts it, so a live
            // capability never reaches a log line (ADR-011, `plugins/logging.ts`).
            serializers: { req: serialiseRequest },
          },
    genReqId: createRequestIdGenerator({ trustProxy: trustProxy !== false }),
    trustProxy: toFastifyTrustProxy(trustProxy),
  })

  registerErrorHandler(app)
  registerRequestIdHeader(app)

  if (deps !== undefined) {
    const serveApiDocs = options.serveApiDocs ?? deps.config.serveApiDocs

    // Headers first: every response, including a 404 or a validation
    // failure, leaves with the same policy on it (ADR-011).
    registerSecurityHeaders(app, { https: deps.config.https, serveApiDocs })

    // Registered before any route: `@fastify/swagger` documents the routes of
    // the context it is registered in, and only those registered after it.
    registerOpenApi(app, { serveUi: serveApiDocs })
  }

  app.register(healthRoutes)

  if (deps !== undefined) {
    for (const schema of [...SHARED_SCHEMAS, ...SHARE_SCHEMAS]) app.addSchema(schema)
    app.register(fastifyCookie)
    registerCsrfProtection(app, {
      appOrigin: deps.config.appOrigin,
      cookieName: deps.config.session.cookieName,
    })

    const audit = createAuditRecorder(deps)
    registerRateLimiting(app, {
      limiter: deps.rateLimiter,
      config: deps.config.rateLimit,
      // The request is already being refused, so the audit write does not
      // hold it up — see `recordInBackground`.
      onExceeded: (request, key) =>
        recordInBackground(
          audit,
          {
            type: AUDIT_EVENTS.rateLimited,
            actorUserId: request.session?.userId ?? null,
            targetType: 'rate-limit-key',
            // The key is `<bucket>:<dimension>:<address or email>`; no secret.
            targetId: key,
          },
          app.log,
        ),
    })

    registerSessionSupport(app, {
      uow: deps.uow,
      clock: deps.clock,
      ids: deps.ids,
      session: deps.config.session,
    })

    app.register(authRoutes(deps))
    app.register(oidcAuthRoutes(deps))
    app.register(meRoutes(deps))
    app.register(unitRoutes(deps))
    app.register(workspaceRoutes(deps))
    app.register(collectionRoutes(deps))
    app.register(documentRoutes(deps))
    app.register(attachmentRoutes(deps))
    app.register(draftRoutes(deps))
    app.register(lockRoutes(deps))
    app.register(searchRoutes(deps))
    app.register(shareLinkRoutes(deps))
    app.register(settingsRoutes(deps))
    app.register(publicSiteRoutes(deps))
  }

  return app
}
