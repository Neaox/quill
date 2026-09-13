import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyPluginAsync } from 'fastify'

import { BRAND } from '@quill/brand'

const LivenessSchema = Type.Object({ status: Type.Literal('ok'), service: Type.String() })
const ReadinessSchema = Type.Object({
  status: Type.Literal('ok'),
  checks: Type.Record(Type.String(), Type.String()),
})

/**
 * Liveness and readiness endpoints (see the plan document, section 25).
 *
 * `/healthz` answers as soon as the process can serve requests.
 * `/readyz` will additionally check the database, content store, and blob
 * store once those exist; until then it mirrors liveness.
 */
export const healthRoutes: FastifyPluginAsync = async (rawApp) => {
  const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

  app.get('/healthz', { schema: { response: { 200: LivenessSchema } } }, async () => ({
    status: 'ok' as const,
    service: BRAND.slug,
  }))

  app.get('/readyz', { schema: { response: { 200: ReadinessSchema } } }, async () => ({
    status: 'ok' as const,
    checks: {},
  }))
}
