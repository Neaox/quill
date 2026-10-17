import { Type } from '@sinclair/typebox'
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  listGroupMembers,
  listGroups,
  removeGroupMember,
  renameGroup,
  searchPeopleForGroups,
} from '@quill/application'
import type { GroupRow } from '@quill/application'
import { userId } from '@quill/domain'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

import { requireInstanceAdmin } from '../application/authorization.ts'
import { strictValidator } from './strict-validator.ts'
import type { AppDependencies } from '../dependencies.ts'
import { conflict, notFound } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'

/** A name with something in it: blank or whitespace-only is not a name. */
const GroupName = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' })

const GroupSummarySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  unitId: Type.String(),
  /** The unit's name under every unit above it, such as "Acme / Platform". */
  unitPath: Type.String(),
  parentGroupId: Type.Union([Type.String(), Type.Null()]),
  memberCount: Type.Integer({ minimum: 0 }),
})

const GroupSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  unitId: Type.String(),
  parentGroupId: Type.Union([Type.String(), Type.Null()]),
})

const PersonSchema = Type.Object({ id: Type.String(), name: Type.String(), email: Type.String() })

const CreateGroupBody = Type.Object(
  {
    unitId: Type.String({ minLength: 1 }),
    name: GroupName,
    // Omit for a top-level group rather than sending `null` (see `units.ts`).
    parentGroupId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
)
const RenameGroupBody = Type.Object({ name: GroupName }, { additionalProperties: false })
const GroupParams = Type.Object({ id: Type.String() })
// A pattern, not `format: 'uuid'`: the strict validator carries no format plugins.
const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
const MemberParams = Type.Object({
  id: Type.String(),
  userId: Type.String({ pattern: UUID_PATTERN }),
})
const PeopleQuery = Type.Object({ q: Type.Optional(Type.String({ maxLength: 200 })) })

const toGroup = (row: GroupRow) => ({
  id: row.id,
  name: row.name,
  unitId: row.unitId,
  parentGroupId: row.parentGroupId,
})

/**
 * Groups and the people in them: instance-admin only (ADR-052).
 *
 * A group is a set of people a grant can name, so who may change one is who
 * may change access across a whole unit; that is the instance administrator's
 * job and nobody else's. Every answer is shaped by the application layer; this
 * file only maps its outcomes to status codes.
 */
export function groupRoutes(deps: AppDependencies): FastifyPluginAsync {
  const requireAdmin = (request: FastifyRequest): Promise<void> =>
    requireInstanceAdmin(deps, request)

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    // Unknown fields are refused, not dropped (`docs/security/checklist.md`).
    app.setValidatorCompiler(strictValidator())

    app.get(
      '/api/groups',
      {
        preHandler: app.requireSession,
        schema: { response: { 200: Type.Object({ groups: Type.Array(GroupSummarySchema) }) } },
      },
      async (request) => {
        await requireAdmin(request)
        return { groups: [...(await listGroups(deps))] }
      },
    )

    app.post(
      '/api/groups',
      {
        preHandler: app.requireVerifiedSession,
        schema: { body: CreateGroupBody, response: { 201: GroupSchema } },
      },
      async (request, reply) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await createGroup(deps, {
          unitId: request.body.unitId,
          name: request.body.name,
          parentGroupId: request.body.parentGroupId ?? null,
          createdBy: session.userId,
        })
        switch (result.kind) {
          case 'unit-not-found':
            throw notFound('That unit does not exist')
          case 'parent-not-found':
            throw notFound('That parent group does not exist')
          case 'parent-in-another-unit':
            throw conflict(
              'group_parent_in_another_unit',
              'A group can only nest inside a group of the same unit',
            )
          case 'name-taken':
            throw conflict('group_name_taken', 'A group with that name already exists here')
          case 'created':
            reply.status(201)
            return toGroup(result.group)
        }
      },
    )

    app.patch(
      '/api/groups/:id',
      {
        preHandler: app.requireVerifiedSession,
        schema: { params: GroupParams, body: RenameGroupBody, response: { 200: GroupSchema } },
      },
      async (request) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await renameGroup(deps, {
          groupId: request.params.id,
          name: request.body.name,
          renamedBy: session.userId,
        })
        if (result.kind === 'not-found') throw notFound('Group not found')
        if (result.kind === 'name-taken') {
          throw conflict('group_name_taken', 'A group with that name already exists here')
        }
        return toGroup(result.group)
      },
    )

    app.delete(
      '/api/groups/:id',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: GroupParams,
          // What went with it, so the screen can say so afterwards.
          response: {
            200: Type.Object({
              members: Type.Integer({ minimum: 0 }),
              grants: Type.Integer({ minimum: 0 }),
            }),
          },
        },
      },
      async (request) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await deleteGroup(deps, {
          groupId: request.params.id,
          deletedBy: session.userId,
        })
        if (result.kind === 'not-found') throw notFound('Group not found')
        if (result.kind === 'has-children') {
          throw conflict(
            'group_has_children',
            'Delete or move the groups nested inside this one first',
            { children: result.children },
          )
        }
        return { members: result.members, grants: result.grants }
      },
    )

    app.get(
      '/api/groups/:id/members',
      {
        preHandler: app.requireSession,
        schema: {
          params: GroupParams,
          response: { 200: Type.Object({ members: Type.Array(PersonSchema) }) },
        },
      },
      async (request) => {
        await requireAdmin(request)
        const result = await listGroupMembers(deps, request.params.id)
        if (result.kind === 'not-found') throw notFound('Group not found')
        return { members: [...result.members] }
      },
    )

    app.put(
      '/api/groups/:id/members/:userId',
      { preHandler: app.requireVerifiedSession, schema: { params: MemberParams } },
      async (request, reply) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await addGroupMember(deps, {
          groupId: request.params.id,
          userId: userId(request.params.userId),
          addedBy: session.userId,
        })
        if (result.kind === 'group-not-found') throw notFound('Group not found')
        if (result.kind === 'user-not-found') throw notFound('Person not found')
        reply.status(204)
      },
    )

    app.delete(
      '/api/groups/:id/members/:userId',
      { preHandler: app.requireVerifiedSession, schema: { params: MemberParams } },
      async (request, reply) => {
        await requireAdmin(request)
        const session = requireAuthenticatedSession(request)
        const result = await removeGroupMember(deps, {
          groupId: request.params.id,
          userId: userId(request.params.userId),
          removedBy: session.userId,
        })
        if (result.kind === 'not-found') throw notFound('Group not found')
        reply.status(204)
      },
    )

    app.get(
      '/api/people',
      {
        preHandler: app.requireSession,
        schema: {
          querystring: PeopleQuery,
          response: { 200: Type.Object({ people: Type.Array(PersonSchema) }) },
        },
      },
      async (request) => {
        await requireAdmin(request)
        return {
          people: [...(await searchPeopleForGroups(deps, { query: request.query.q ?? '' }))],
        }
      },
    )
  }
}
