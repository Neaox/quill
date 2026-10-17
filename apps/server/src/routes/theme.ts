import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { customEmojiByName, labelEmoji, readOrganisationSettings } from '@quill/application'
import type { RenderedEmoji } from '@quill/application'
import { EMOJI_NAME_PATTERN, LABEL_NAME_PATTERN } from '@quill/theme'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

import type { AppDependencies } from '../dependencies.ts'
import { AppError, notFound, notModified } from '../errors.ts'
import { addressRateLimit } from '../plugins/rate-limit.ts'
import { FONT_MAX_AGE_SECONDS, FONT_ROUTE_PREFIX, SERVED_FONT_NAME } from '../theme/face-files.ts'
import { THEME_STYLESHEET_PATH } from '../theme/theme-stylesheet.ts'
import type { ThemeStylesheet } from '../theme/theme-stylesheet.ts'
import { pageLayoutAttributes } from '../theme/page-attributes.ts'
import { PUBLIC_SITE_BUCKET } from './public-site.ts'

/**
 * The organisation's theme, delivered (ADR-028, "Delivery";
 * `docs/architecture/api-contract-settings.md`).
 *
 * Three routes, and none of them reads a session:
 *
 * - `GET /api/settings/organisation/theme` — the identity `<html>` carries in
 *   `data-theme-id`, and the address of the stylesheet to link;
 * - `GET /api/settings/organisation/theme.css` — that stylesheet, with a
 *   strong `ETag` of its content hash, revalidated on every use so a saved
 *   theme shows on the next page anybody opens;
 * - `GET /api/fonts/:file` — the faces the stylesheet names, addressed by
 *   their own content and therefore immutable.
 *
 * **Public on purpose.** Reading the organisation's settings needs a session,
 * because they hold policies and navigation a stranger has no business with.
 * The theme is different: it is on every public page and every share link,
 * both of which render with it and neither of which has a session, so what
 * these routes answer is already published to anybody who opens either. They
 * answer with what the generator made of the theme and nothing else — no
 * name, no policy, no revision — and they count against the public site's
 * per-address budget like every other route a stranger reaches.
 */

/** What the application needs to apply the theme: no more. */
export const ThemeSummarySchema = Type.Object(
  {
    /** The value of `data-theme-id` on `<html>`. */
    themeId: Type.String(),
    /** The stylesheet to link: the route, with the sheet's hash as a cache key. */
    stylesheetHref: Type.String(),
    /**
     * The layout attributes `<html>` carries beside the identity —
     * `data-rules` and `data-align` today (`theme/page-attributes.ts`) —
     * each present only when the organisation's layout or its theme states it.
     */
    attributes: Type.Record(Type.String({ pattern: '^data-[a-z]+$' }), Type.String()),
    /**
     * The organisation's label names (ADR-037), so the editor draws
     * `:acme[Acme]` as the reader will. Names only, which every public
     * page that shows a label already carries; the colours are the sheet's.
     */
    labels: Type.Array(Type.String({ pattern: LABEL_NAME_PATTERN })),
    /**
     * The organisation's own emoji (ADR-038), so the editor draws `:acme:`
     * as the reader will: each name, its address and its size. Every public
     * page that shows one already carries the same.
     */
    emoji: Type.Array(
      Type.Object(
        {
          name: Type.String({ pattern: EMOJI_NAME_PATTERN }),
          src: Type.String(),
          /** An animation's still, for a reader who asks for less motion. */
          still: Type.Optional(Type.String()),
          /** An animation's frames and loop length, for the reader's brief play (ADR-047). */
          frames: Type.Optional(Type.Integer({ minimum: 1 })),
          milliseconds: Type.Optional(Type.Integer({ minimum: 1 })),
          width: Type.Integer({ minimum: 1 }),
          height: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
    ),
    /** The emoji each label's pill leads with, by label name (ADR-038). */
    labelEmoji: Type.Record(
      Type.String({ pattern: LABEL_NAME_PATTERN }),
      Type.String({ pattern: EMOJI_NAME_PATTERN }),
    ),
  },
  { $id: 'OrganisationThemeSummary', additionalProperties: false },
)

const StylesheetQuery = Type.Object({ v: Type.Optional(Type.String({ maxLength: 64 })) })
const FontParams = Type.Object({ file: Type.String({ maxLength: 160 }) })

export function themeRoutes(deps: AppDependencies): FastifyPluginAsync {
  const budget = addressRateLimit(PUBLIC_SITE_BUCKET, deps.config.publicSiteRateLimitMax)

  /**
   * The organisation's theme as a stylesheet.
   *
   * A settings file this release cannot read is a refusal that names nothing:
   * the routes on the settings screens tell an instance administrator which
   * revision to repair, and this one answers strangers. The application keeps
   * the identity its bundle carries, which is still a styled page.
   */
  const currentTheme = async (
    request: FastifyRequest,
  ): Promise<{
    sheet: ThemeStylesheet
    attributes: Readonly<Record<string, string>>
    labels: readonly string[]
    emoji: readonly ({ name: string } & RenderedEmoji)[]
    labelEmoji: Readonly<Record<string, string>>
  }> => {
    const settings = await readOrganisationSettings(deps)
    if (settings.kind === 'unreadable') {
      request.log.error(
        { revision: settings.revision, reason: settings.reason },
        'A settings file in the system workspace cannot be read by this release',
      )
      throw new AppError(
        500,
        'settings_unreadable',
        'This instance cannot read its own settings file, so it cannot say what its theme is.',
      )
    }
    const { theme, layout, emoji } = settings.document
    return {
      sheet: deps.themeStylesheets.forTheme(theme),
      attributes: pageLayoutAttributes([layout.default, theme.variants]),
      labels: (theme.labels ?? []).map((label) => label.name),
      emoji: [...customEmojiByName(emoji)].map(([name, image]) => ({ name, ...image })),
      labelEmoji: Object.fromEntries(labelEmoji(theme, emoji)),
    }
  }

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()
    app.addSchema(ThemeSummarySchema)

    app.get(
      '/api/settings/organisation/theme',
      {
        config: budget,
        schema: { response: { 200: Type.Ref(ThemeSummarySchema) } },
      },
      async (request, reply) => {
        const {
          sheet,
          attributes,
          labels,
          emoji,
          labelEmoji: leading,
        } = await currentTheme(request)
        // Stored, but asked again every time: the answer is a few bytes, and
        // it is what tells an open tab that the theme changed.
        reply.header('cache-control', 'no-cache')
        return {
          themeId: sheet.identity,
          stylesheetHref: sheet.href,
          attributes,
          labels,
          emoji,
          labelEmoji: leading,
        }
      },
    )

    app.get(
      THEME_STYLESHEET_PATH,
      // Not in the OpenAPI description: a stylesheet is linked, not called,
      // and the generated client has nothing to do with it.
      { config: budget, schema: { querystring: StylesheetQuery, hide: true } },
      async (request, reply) => {
        const { sheet } = await currentTheme(request)
        const etag = `"${sheet.hash}"`
        reply.header('etag', etag)
        // `no-cache` is "keep it, and ask before using it": every page view
        // costs one conditional request answered with an empty `304`, and a
        // saved theme is on the very next one. The `?v=` the application
        // links with already moves when the theme does; this is what keeps a
        // bare address honest too.
        reply.header('cache-control', 'public, no-cache')
        reply.type('text/css; charset=utf-8')
        if (request.headers['if-none-match'] === etag) throw notModified()
        return sheet.css
      },
    )

    app.get(
      `${FONT_ROUTE_PREFIX}/:file`,
      { config: budget, schema: { params: FontParams, hide: true } },
      async (request, reply) => {
        const served = SERVED_FONT_NAME.test(request.params.file)
          ? deps.faceFiles.byName(request.params.file)
          : null
        if (served === null) throw notFound('No such font')
        reply.type('font/woff2')
        reply.header('cache-control', `public, max-age=${FONT_MAX_AGE_SECONDS}, immutable`)
        return served.bytes
      },
    )
  }
}
