import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { describeMenuTargets, findCollectionCandidates } from '@quill/application'
import type { FastifyPluginAsync } from 'fastify'

import { requireInstanceAdmin } from '../application/authorization.ts'
import type { AppDependencies } from '../dependencies.ts'
import { cachedPublicSiteLoader } from '../public-site/menu.ts'

/**
 * What the public menu editor asks while somebody builds the menu
 * (`docs/architecture/api-contract-settings.md`, "The public menu").
 *
 * Two reads, both instance administration, because the menu is the
 * organisation's and so is the person editing it:
 *
 * - `GET /settings/organisation/public-menu/targets` describes the documents
 *   and collections a menu names: each one's current title, where it sits,
 *   and whether a reader will see it — so the editor can show the live title
 *   beside a custom label, and show a link whose target has since been
 *   deleted as one to fix rather than as a blank.
 * - `GET /settings/organisation/public-menu/collections` finds collections by
 *   name across every workspace, for the target combobox; documents are found
 *   through `GET /search`, which already crosses workspaces.
 *
 * Neither writes, and both are bounded: at most a hundred ids, at most twenty
 * candidates. Whether a target is public is answered by the same resolution
 * the public site renders the menu with (`resolvePublicMenu`).
 */

const MAX_TARGETS = 100
const MAX_CANDIDATES = 20

const IdList = Type.Array(Type.String({ maxLength: 64 }), { maxItems: MAX_TARGETS })

const TargetsQuery = Type.Object(
  {
    document: Type.Optional(IdList),
    collection: Type.Optional(IdList),
  },
  { additionalProperties: false },
)

const MenuTargetSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal('document'), Type.Literal('collection')]),
    id: Type.String(),
    status: Type.Union([
      Type.Literal('public'),
      Type.Literal('not-public'),
      Type.Literal('missing'),
    ]),
    title: Type.Union([Type.String(), Type.Null()]),
    workspaceName: Type.Union([Type.String(), Type.Null()]),
    collectionName: Type.Union([Type.String(), Type.Null()]),
    href: Type.Union([Type.String(), Type.Null()]),
  },
  { $id: 'PublicMenuTarget' },
)

const CollectionsQuery = Type.Object(
  {
    q: Type.String({ minLength: 1, maxLength: 200 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_CANDIDATES })),
  },
  { additionalProperties: false },
)

const CollectionCandidateSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    workspaceName: Type.String(),
    isPublic: Type.Boolean(),
  },
  { $id: 'PublicMenuCollectionCandidate' },
)

export function publicMenuRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    app.addSchema(MenuTargetSchema)
    app.addSchema(CollectionCandidateSchema)

    app.get(
      '/api/settings/organisation/public-menu/targets',
      {
        preHandler: app.requireSession,
        schema: {
          querystring: TargetsQuery,
          response: {
            200: Type.Object({ targets: Type.Array(Type.Ref(MenuTargetSchema)) }),
          },
        },
      },
      async (request) => {
        await requireInstanceAdmin(deps, request)
        const targets = await describeMenuTargets(
          { uow: deps.uow, loadSite: cachedPublicSiteLoader(deps) },
          {
            documents: [...new Set(request.query.document ?? [])],
            collections: [...new Set(request.query.collection ?? [])],
          },
        )
        return { targets: [...targets] }
      },
    )

    app.get(
      '/api/settings/organisation/public-menu/collections',
      {
        preHandler: app.requireSession,
        schema: {
          querystring: CollectionsQuery,
          response: {
            200: Type.Object({
              collections: Type.Array(Type.Ref(CollectionCandidateSchema)),
            }),
          },
        },
      },
      async (request) => {
        await requireInstanceAdmin(deps, request)
        const collections = await findCollectionCandidates(
          deps,
          request.query.q,
          request.query.limit ?? 8,
        )
        return { collections: [...collections] }
      },
    )
  }
}
