import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  MAX_REVIEWERS,
  MAX_REVIEW_TEXT,
  decideReview,
  getAttention,
  getReview,
  listReviewerCandidates,
  requestReview,
  withdrawReview,
} from '@quill/application'
import type { ReviewRequestView } from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import { authorizerFor, requireDocumentAccess } from '../application/authorization.ts'
import { resolveDocumentId } from '../application/references.ts'
import type { AppDependencies } from '../dependencies.ts'
import { forbidden, notFound, unprocessable } from '../errors.ts'
import { strictValidator } from './strict-validator.ts'
import { requireAuthenticatedSession } from '../plugins/session.ts'
import { IdParamsSchema } from './document-schemas.ts'

/**
 * Review requests (ADR-052, "API contract (first build)").
 *
 * Every route authorises through the one resolver and then calls a use case.
 * Reading and answering need `view`; asking needs `edit`; the use cases decide
 * the rest (who is tagged, who may withdraw), because those are facts about
 * the request rather than about a role.
 */

const NullableDateTime = Type.Union([Type.String({ format: 'date-time' }), Type.Null()])

const PersonRefSchema = Type.Object({ id: Type.String(), name: Type.String() })

const ReviewRequestSchema = Type.Object({
  id: Type.String(),
  documentId: Type.String(),
  status: Type.Union([
    Type.Literal('open'),
    Type.Literal('approved'),
    Type.Literal('changes_requested'),
    Type.Literal('withdrawn'),
    Type.Literal('superseded'),
    Type.Literal('published'),
  ]),
  requestedBy: PersonRefSchema,
  /** Plain text, at most 1,000 characters. */
  message: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  /** The draft this was asked about. */
  draftVersion: Type.Integer(),
  /** The draft has changed since. */
  stale: Type.Boolean(),
  assignments: Type.Array(
    Type.Object({
      id: Type.String(),
      reviewer: Type.Object({
        kind: Type.Union([Type.Literal('user'), Type.Literal('group')]),
        id: Type.String(),
        name: Type.String(),
        memberCount: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      state: Type.Union([
        Type.Literal('pending'),
        Type.Literal('approved'),
        Type.Literal('changes_requested'),
      ]),
      /** For a group, the member who answered. */
      decidedBy: Type.Union([PersonRefSchema, Type.Null()]),
      comment: Type.Union([Type.String(), Type.Null()]),
      decidedAt: NullableDateTime,
    }),
  ),
  /** The request is open and the caller is tagged on it, directly or through a group. */
  canDecide: Type.Boolean(),
  /** The request is open and the caller made it or may manage the document. */
  canWithdraw: Type.Boolean(),
})

const ReviewEnvelopeSchema = Type.Object({
  request: Type.Union([ReviewRequestSchema, Type.Null()]),
})

const ReviewerRefSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal('user'), Type.Literal('group')]),
    id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

// Unknown fields are refused, not dropped (`docs/security/checklist.md`): a client written
// against a newer release should be told, not quietly given a different result.
const RequestReviewBodySchema = Type.Object(
  {
    reviewers: Type.Array(ReviewerRefSchema, { minItems: 1, maxItems: MAX_REVIEWERS }),
    message: Type.Optional(Type.String({ maxLength: MAX_REVIEW_TEXT })),
  },
  { additionalProperties: false },
)

const DecisionBodySchema = Type.Object(
  {
    decision: Type.Union([Type.Literal('approve'), Type.Literal('request_changes')]),
    comment: Type.Optional(Type.String({ maxLength: MAX_REVIEW_TEXT })),
  },
  { additionalProperties: false },
)

const CandidatesQuerySchema = Type.Object({ q: Type.Optional(Type.String({ maxLength: 100 })) })

const CandidatesSchema = Type.Object({
  people: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      email: Type.String(),
      canView: Type.Boolean(),
    }),
  ),
  groups: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      memberCount: Type.Integer({ minimum: 0 }),
      canView: Type.Boolean(),
    }),
  ),
})

const AttentionSchema = Type.Object({
  items: Type.Array(
    Type.Object({
      kind: Type.Union([
        Type.Literal('review-requested'),
        Type.Literal('changes-requested'),
        Type.Literal('review-approved'),
      ]),
      requestId: Type.String(),
      document: Type.Object({
        id: Type.String(),
        shortId: Type.String(),
        title: Type.String(),
        workspaceId: Type.String(),
      }),
      by: PersonRefSchema,
      at: Type.String({ format: 'date-time' }),
    }),
  ),
})

const toResponse = (review: ReviewRequestView) => ({
  ...review,
  createdAt: review.createdAt.toISOString(),
  assignments: review.assignments.map((assignment) => ({
    ...assignment,
    decidedAt: assignment.decidedAt?.toISOString() ?? null,
  })),
})

export function reviewRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    app.setValidatorCompiler(strictValidator())

    app.get(
      '/api/documents/:id/review',
      {
        preHandler: app.requireSession,
        schema: { params: IdParamsSchema, response: { 200: ReviewEnvelopeSchema } },
      },
      async (request) => {
        const session = requireAuthenticatedSession(request)
        const access = await requireDocumentAccess(
          authorizerFor(deps, request),
          await resolveDocumentId(deps, request.params.id),
          'view',
        )
        const review = await getReview(deps, {
          documentId: access.document.id,
          userId: session.userId,
          canEdit: access.capabilities.edit,
          canManage: access.capabilities.manage,
        })
        return { request: review === null ? null : toResponse(review) }
      },
    )

    app.post(
      '/api/documents/:id/review',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: IdParamsSchema,
          body: RequestReviewBodySchema,
          response: { 201: ReviewRequestSchema },
        },
      },
      async (request, reply) => {
        const session = requireAuthenticatedSession(request)
        const access = await requireDocumentAccess(
          authorizerFor(deps, request),
          await resolveDocumentId(deps, request.params.id),
          'edit',
        )
        const result = await requestReview(deps, {
          documentId: access.document.id,
          requestedBy: session.userId,
          canManage: access.capabilities.manage,
          reviewers: request.body.reviewers,
          ...(request.body.message === undefined ? {} : { message: request.body.message }),
        })
        switch (result.kind) {
          case 'requested':
            return reply.code(201).send(toResponse(result.review))
          case 'reviewers-cannot-view':
            throw unprocessable(
              'reviewer_cannot_view',
              'Everyone asked to review needs to be able to view this document',
              { reviewers: result.reviewers },
            )
          case 'invalid-reviewers':
            throw unprocessable(
              'invalid_reviewers',
              `Ask between 1 and ${MAX_REVIEWERS} reviewers`,
              { count: result.count },
            )
          /* v8 ignore next 2 -- the authorizer has already loaded this document. */
          case 'not-found':
            throw notFound('Document not found')
        }
      },
    )

    app.post(
      '/api/documents/:id/review/decision',
      {
        preHandler: app.requireVerifiedSession,
        schema: {
          params: IdParamsSchema,
          body: DecisionBodySchema,
          response: { 200: ReviewRequestSchema },
        },
      },
      async (request) => {
        const session = requireAuthenticatedSession(request)
        const access = await requireDocumentAccess(
          authorizerFor(deps, request),
          await resolveDocumentId(deps, request.params.id),
          'view',
        )
        const result = await decideReview(deps, {
          documentId: access.document.id,
          userId: session.userId,
          canManage: access.capabilities.manage,
          decision: request.body.decision,
          ...(request.body.comment === undefined ? {} : { comment: request.body.comment }),
        })
        switch (result.kind) {
          case 'decided':
            return toResponse(result.review)
          case 'no-open-request':
            throw notFound('There is no open review request on this document')
          case 'not-assigned':
            throw forbidden('You were not asked to review this document')
        }
      },
    )

    app.delete(
      '/api/documents/:id/review',
      { preHandler: app.requireVerifiedSession, schema: { params: IdParamsSchema } },
      async (request, reply) => {
        const session = requireAuthenticatedSession(request)
        const access = await requireDocumentAccess(
          authorizerFor(deps, request),
          await resolveDocumentId(deps, request.params.id),
          'view',
        )
        const result = await withdrawReview(deps, {
          documentId: access.document.id,
          userId: session.userId,
          canManage: access.capabilities.manage,
        })
        switch (result.kind) {
          case 'withdrawn':
            return reply.code(204).send()
          case 'no-open-request':
            throw notFound('There is no open review request on this document')
          case 'forbidden':
            throw forbidden(
              'Only the person who asked, or someone who can manage this, can withdraw it',
            )
        }
      },
    )

    app.get(
      '/api/documents/:id/reviewer-candidates',
      {
        preHandler: app.requireSession,
        schema: {
          params: IdParamsSchema,
          querystring: CandidatesQuerySchema,
          response: { 200: CandidatesSchema },
        },
      },
      async (request) => {
        const access = await requireDocumentAccess(
          authorizerFor(deps, request),
          await resolveDocumentId(deps, request.params.id),
          'edit',
        )
        const found = await listReviewerCandidates(deps, {
          documentId: access.document.id,
          query: request.query.q ?? '',
          canManage: access.capabilities.manage,
        })
        return { people: [...found.people], groups: [...found.groups] }
      },
    )

    app.get(
      '/api/me/attention',
      { preHandler: app.requireSession, schema: { response: { 200: AttentionSchema } } },
      async (request) => {
        const session = requireAuthenticatedSession(request)
        const items = await getAttention(deps, {
          userId: session.userId,
          authorizer: authorizerFor(deps, request),
        })
        return { items: items.map((item) => ({ ...item, at: item.at.toISOString() })) }
      },
    )
  }
}
