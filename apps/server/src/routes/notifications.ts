import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  NOTIFICATION_PAGE_DEFAULT,
  NOTIFICATION_PAGE_MAX,
  listNotifications,
  markNotificationsRead,
} from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor } from '../application/authorization.ts'
import type { AppDependencies } from '../dependencies.ts'
import { unprocessable } from '../errors.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import { strictValidator } from './strict-validator.ts'

/**
 * The signed-in person's own notifications (ADR-053, "Notifications").
 *
 * Both routes are `/api/me/…` and act on the session's user only, so there is
 * no id of a person to get wrong: a notification id that is not the caller's
 * simply matches nothing.
 */

/** A page's worth of ids is plenty for "mark these read"; more is "mark all". */
const MAX_IDS = 200

const KindSchema = Type.Union([
  Type.Literal('review-requested'),
  Type.Literal('changes-requested'),
  Type.Literal('review-approved'),
  Type.Literal('review-withdrawn'),
])

const NotificationsQuerySchema = Type.Object({
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: NOTIFICATION_PAGE_MAX,
      default: NOTIFICATION_PAGE_DEFAULT,
    }),
  ),
  /** The `next` of the page before. */
  before: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
})

const NotificationsSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.String(),
      kind: KindSchema,
      document: Type.Object({
        id: Type.String(),
        shortId: Type.String(),
        title: Type.String(),
        workspaceId: Type.String(),
      }),
      actor: Type.Object({ id: Type.String(), name: Type.String() }),
      at: Type.String({ format: 'date-time' }),
      readAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    }),
  ),
  /** Every unread notification of the caller's, including any about documents they can no longer view. */
  unread: Type.Integer({ minimum: 0 }),
  /** Pass as `before` for the next page; absent on the last. */
  next: Type.Optional(Type.String()),
})

const MarkReadBodySchema = Type.Object(
  {
    /** Omitted, every unread notification is marked read. */
    ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: MAX_IDS })),
  },
  { additionalProperties: false },
)

export function notificationRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      '/api/me/notifications',
      {
        preHandler: app.requireSession,
        schema: { querystring: NotificationsQuerySchema, response: { 200: NotificationsSchema } },
      },
      async (request) => {
        const session = requireAuthenticatedSession(request)
        const result = await listNotifications(deps, {
          userId: session.userId,
          authorizer: authorizerFor(deps, request),
          limit: request.query.limit,
          before: request.query.before,
        })
        if (result.kind === 'bad-cursor') {
          throw unprocessable('invalid_cursor', 'That page marker was not issued by this server.')
        }
        return {
          items: result.items.map((item) => ({
            ...item,
            at: item.at.toISOString(),
            readAt: item.readAt?.toISOString() ?? null,
          })),
          unread: result.unread,
          ...(result.next === undefined ? {} : { next: result.next }),
        }
      },
    )

    // Strict only for the body: the query's `limit` arrives as a string and
    // wants the default validator's coercion.
    app.register(async (strict) => {
      strict.setValidatorCompiler(strictValidator())
      strict.withTypeProvider<TypeBoxTypeProvider>().post(
        '/api/me/notifications/read',
        {
          preHandler: app.requireSession,
          schema: { body: MarkReadBodySchema, response: { 204: Type.Null() } },
        },
        async (request, reply) => {
          const session = requireAuthenticatedSession(request)
          await markNotificationsRead(deps, { userId: session.userId, ids: request.body.ids })
          reply.status(204)
        },
      )
    })
  }
}
