import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyPluginAsync } from 'fastify'

import type { AppDependencies } from '../../dependencies.ts'

/**
 * `GET /api/extensions/drawio`: where this instance's draw.io editor is, for
 * the web app to embed (ADR-043).
 *
 * Instance configuration rather than an organisation setting, because the
 * editor is something the operator deploys and the CSP is built from: the
 * page may frame exactly the origin named here. Signed-in only — the editor
 * is for writers — and it says whether the editor is a third party's, so the
 * editor can tell a writer where their diagram is going.
 */

export const DrawioEditorSchema = Type.Object(
  {
    editor: Type.Union([
      Type.Object({
        /** The editor page, opened in embed mode. */
        url: Type.String(),
        /** The only origin the app accepts the editor's messages from. */
        origin: Type.String(),
        /** True when it is diagrams.net's hosted editor. */
        thirdParty: Type.Boolean(),
      }),
      Type.Null(),
    ]),
  },
  { $id: 'DrawioEditor' },
)

export function drawioRoutes(deps: AppDependencies): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    app.addSchema(DrawioEditorSchema)

    app.get(
      '/api/extensions/drawio',
      {
        preHandler: app.requireSession,
        schema: { response: { 200: Type.Ref(DrawioEditorSchema) } },
      },
      async () => ({ editor: deps.config.drawio.editor }),
    )
  }
}
