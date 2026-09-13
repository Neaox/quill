import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import type { FastifyInstance } from 'fastify'

import { BRAND } from '@quill/brand'

export interface OpenApiOptions {
  /**
   * Serves the API description at all: the JSON document at
   * `/api/openapi.json` and the interactive Swagger UI at `/api/docs`.
   *
   * Both are gated by the same flag, which `config.ts` turns off under
   * `NODE_ENV=production`. The JSON is the route map — every path, every
   * parameter, every error shape — and publishing it unauthenticated is
   * reconnaissance handed over, whether a browser renders it or not.
   */
  readonly serveUi: boolean
}

/**
 * Fastify + typebox schemas generate the OpenAPI description (ADR-025).
 *
 * Registered directly on the instance that owns the routes, and before them:
 * `@fastify/swagger` documents the routes of the context it is registered in,
 * so wrapping this in a child plugin would produce a description with no paths.
 * Fastify queues registrations in order, so nothing here needs awaiting.
 */
export function registerOpenApi(app: FastifyInstance, options: OpenApiOptions): void {
  app.register(fastifySwagger, {
    openapi: {
      info: { title: `${BRAND.name} API`, version: '0.0.0' },
    },
    // Shared schemas keep the name they were given, so the generated client
    // reads `OutlineEntry` rather than `def-0`. Fastify refuses to register a
    // shared schema without an `$id`, so there is always a name to use.
    refResolver: { buildLocalReference: (json) => `${json['$id']}` },
  })

  if (options.serveUi) {
    app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger())
    app.register(fastifySwaggerUi, { routePrefix: '/api/docs' })
  }
}
