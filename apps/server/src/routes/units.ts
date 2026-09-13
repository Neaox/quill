import { Type } from '@sinclair/typebox'
import { createUnit, deleteUnit, renameUnit } from '@quill/application'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

import { requireInstanceAdmin } from '../application/authorization.ts'
import type { AppDependencies } from '../dependencies.ts'
import { conflict, notFound } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'

const CreateUnitBody = Type.Object({
  name: Type.String({ minLength: 1 }),
  /** Defaults to a slug of the name, and to the neutral label "unit" (ADR-012). */
  slug: Type.Optional(Type.String({ minLength: 1, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' })),
  label: Type.Optional(Type.String({ minLength: 1 })),
  // Omit for a top-level unit rather than sending `null`: Ajv's type coercion
  // (on by default under Fastify) coerces a `null` payload value to `""` for
  // a `string | null` union before the `null` branch is tried, so an
  // explicit null in the body would silently become an empty string.
  parentId: Type.Optional(Type.String({ minLength: 1 })),
})

const RenameUnitBody = Type.Object({ name: Type.String({ minLength: 1 }) })

const ListUnitsQuery = Type.Object({ parentId: Type.Optional(Type.String()) })

const IdParams = Type.Object({ id: Type.String() })

/**
 * Organisational units: instance-admin only (ADR-012 — "an instance admin
 * role exists separately from workspace owner"; this is that role's first
 * use). Full grant-scope resolution across the unit tree is being built in
 * `packages/domain` concurrently — see `application/permissions.ts`.
 */
export function unitRoutes(deps: AppDependencies): FastifyPluginAsync {
  const requireAdmin = (request: FastifyRequest): Promise<void> =>
    requireInstanceAdmin(deps, request)

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.post(
      '/api/units',
      { preHandler: app.requireVerifiedSession, schema: { body: CreateUnitBody } },
      async (request, reply) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await createUnit(deps, {
          parentId: request.body.parentId ?? null,
          name: request.body.name,
          slug: request.body.slug,
          label: request.body.label,
          createdBy: session.userId,
        })
        if (result.kind === 'parent-not-found') {
          throw notFound('That parent unit does not exist')
        }
        reply.status(201)
        return result.unit
      },
    )

    app.get(
      '/api/units',
      { preHandler: app.requireSession, schema: { querystring: ListUnitsQuery } },
      async (request) => {
        await requireAdmin(request)
        const parentId = request.query.parentId ?? null
        return deps.uow.repos.units.listChildren(parentId)
      },
    )

    app.get(
      '/api/units/:id',
      { preHandler: app.requireSession, schema: { params: IdParams } },
      async (request) => {
        await requireAdmin(request)
        const unit = await deps.uow.repos.units.findById(request.params.id)
        if (unit === null) {
          throw notFound('Unit not found')
        }
        return unit
      },
    )

    app.patch(
      '/api/units/:id',
      {
        preHandler: app.requireVerifiedSession,
        schema: { params: IdParams, body: RenameUnitBody },
      },
      async (request) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await renameUnit(deps, {
          unitId: request.params.id,
          name: request.body.name,
          renamedBy: session.userId,
        })
        if (result.kind === 'not-found') throw notFound('Unit not found')
        return result.unit
      },
    )

    app.delete(
      '/api/units/:id',
      { preHandler: app.requireVerifiedSession, schema: { params: IdParams } },
      async (request, reply) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await deleteUnit(deps, {
          unitId: request.params.id,
          deletedBy: session.userId,
        })
        if (result.kind === 'not-found') throw notFound('Unit not found')
        if (result.kind === 'not-empty') {
          // `unit_id` and `parent_id` cascade, so this would take a whole tree
          // of documentation with it (ADR-012).
          throw conflict(
            'unit_not_empty',
            'Move or delete this unit’s workspaces and child units before deleting it',
            { workspaces: result.workspaces, units: result.units },
          )
        }
        reply.status(204)
      },
    )
  }
}
