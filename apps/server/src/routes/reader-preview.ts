import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  documentReference,
  loadReaderPreview,
  publicPageHref,
  publicSiteHref,
  publishedAt,
  readPublicFacts,
  renderDocument,
  resolveDocumentReferences,
} from '@quill/application'
import type {
  ChildPagesAudience,
  PublicNavigationNode,
  ReaderPreview,
  Replacement,
} from '@quill/application'
import type { DocumentId } from '@quill/domain'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import { authorizerFor, requireDocumentAccess } from '../application/authorization.ts'
import { resolveDocumentId } from '../application/references.ts'
import { fillChildPages } from '../child-pages/fill.ts'
import type { AppDependencies } from '../dependencies.ts'
import { AppError, conflict } from '../errors.ts'
import {
  renderDocumentMain,
  renderNoPreviewPage,
  renderUnpublishedMain,
} from '../public-site/pages.ts'
import { createReaderScript } from '../public-site/reader-script.ts'
import { cachedHeaderMenu } from '../public-site/menu.ts'
import { createSchemeScript } from '../public-site/scheme-script.ts'
import { html } from '../public-site/html.ts'
import { renderByline } from '../public-site/templates/byline.ts'
import { renderLifecycleNotice } from '../public-site/templates/lifecycle-notice.ts'
import { navigationSection } from '../public-site/templates/navigation.ts'
import { renderPage } from '../public-site/templates/page.ts'
import { renderPreviewBanner } from '../public-site/templates/preview-banner.ts'
import { pageLayoutAttributes } from '../theme/page-attributes.ts'

/**
 * The reader preview: a document as a reader of the public site will see it
 * (`docs/architecture/api-contract-reader-preview.md`).
 *
 * `GET /preview/d/:documentRef` renders any document the signed-in member may
 * view through **the public site's own templates** — the same page shell,
 * navigation, contents, stylesheet and script — whether or not its collection
 * is published, so what a member checks is what a reader gets. Like the public
 * site it is HTML rather than an API endpoint, and it is not in the OpenAPI
 * description.
 *
 * It differs from a public page in exactly the ways a private page must:
 *
 * - **A session is required**, and the resolver decides (ADR-012): the
 *   document needs `view`, checked by `requireDocumentAccess` like every
 *   document route, and the navigation lists only what this member may read
 *   (`loadReaderPreview`). A request with no session is sent to sign in and
 *   back; one that may not read the document gets the same page a missing
 *   document gets.
 * - **Never indexed and never cached publicly**: `noindex,nofollow` in the
 *   page and in `X-Robots-Tag`, no canonical, no structured data, and
 *   `Cache-Control: private, no-store`, because the page carries whatever this
 *   member may read and a shared cache must never hand it to anybody else.
 * - **Marked as a preview** by a banner fixed to the bottom of the window,
 *   which does not move the layout it is previewing.
 */

export const READER_PREVIEW_PREFIX = '/preview/d'

/** The preview of a document, by its readable reference (ADR-035). */
export function readerPreviewHref(reference: string): string {
  return `${READER_PREVIEW_PREFIX}/${reference}`
}

const PreviewParams = Type.Object({ documentRef: Type.String({ minLength: 1, maxLength: 400 }) })

const NOT_FOR_INDEXING = 'noindex,nofollow'

/** The headers every answer carries, the redirect and the refusals included. */
function privately(reply: FastifyReply): void {
  reply.header('cache-control', 'private, no-store')
  // Tighter than the platform's `strict-origin-when-cross-origin`: nothing on
  // a preview tells another origin that this instance was being looked at.
  reply.header('referrer-policy', 'no-referrer')
  reply.header('x-robots-tag', 'noindex, nofollow')
}

function sendHtml(reply: FastifyReply, status: number, page: string): FastifyReply {
  return reply.status(status).type('text/html; charset=utf-8').send(page)
}

/** One answer for missing and for refused, so neither is distinguishable. */
function nothingToPreview(reply: FastifyReply): FastifyReply {
  return sendHtml(reply, 404, renderNoPreviewPage())
}

export function readerPreviewRoutes(deps: AppDependencies): FastifyPluginAsync {
  const schemeScript = createSchemeScript(deps.hasher)
  const readerScript = createReaderScript(deps.hasher)

  /** The id the reference names, or null when it names nothing. */
  const documentIdOf = async (reference: string): Promise<DocumentId | null> => {
    try {
      return await resolveDocumentId(deps, reference)
    } catch (error) {
      /* v8 ignore next -- resolution only ever refuses with a 404. */
      if (!(error instanceof AppError) || error.statusCode !== 404) throw error
      return null
    }
  }

  /**
   * A deprecated page's replacement as the preview names it: a page in one of
   * the sections the preview shows, opening its own preview, or nothing.
   */
  const previewReplacement = async (
    preview: ReaderPreview,
    reference: string | undefined,
  ): Promise<Replacement | undefined> => {
    if (reference === undefined) return undefined
    const id = (await resolveDocumentReferences(deps.uow.repos.documents, [reference])).get(
      reference,
    )
    const shown = preview.sections
      .flatMap((section) => [...flatten(section.navigation)])
      .find((node) => node.documentId === id)
    return shown === undefined
      ? undefined
      : { href: readerPreviewHref(shown.path), title: shown.title }
  }

  const pageOf = async (preview: ReaderPreview, audience: ChildPagesAudience): Promise<string> => {
    const { document, collection, workspace, organisation } = preview
    const rendered = await renderDocument(deps, { documentId: document.id, indexLinks: false })
    // The pages under this one, as this reader may see them, each opening its
    // own preview (ADR-054).
    const bodyHtml =
      rendered.kind === 'rendered'
        ? await fillChildPages(deps, {
            html: rendered.content.html,
            parent: document,
            workspace,
            audience,
            hrefOf: (child) => readerPreviewHref(documentReference(child)),
          })
        : ''
    let updatedAt: Date | null = null
    if (rendered.kind === 'rendered') {
      const published = await publishedAt(deps, [document])
      /* v8 ignore next -- `publishedAt` answers for every document it is given. */
      updatedAt = published.get(document.id) ?? document.updatedAt
    }
    // The facts a public reader would see, as they would see them; a preview
    // has no search, so its tags are words (ADR-055).
    const facts =
      rendered.kind === 'rendered' ? await readPublicFacts(deps, document, deps.clock.now()) : null
    const notice =
      facts?.lifecycle?.state === 'deprecated'
        ? renderLifecycleNotice(await previewReplacement(preview, facts.lifecycle.supersededBy))
        : html``
    const publicHref =
      preview.publicAddress === null
        ? null
        : publicPageHref(preview.publicAddress.siteSlug, preview.publicAddress.path)

    const stylesheet = deps.publicStylesheets.forTheme(organisation.theme)
    return renderPage({
      siteName: organisation.name,
      homeHref:
        preview.publicAddress === null ? null : publicSiteHref(preview.publicAddress.siteSlug),
      // The header menu is the public one, resolved exactly as a public page
      // resolves it: a preview of a page shows the menu its reader will see,
      // so a link to something that is not public is left out here too.
      menu: await cachedHeaderMenu(deps, organisation),
      currentHref: publicHref,
      // A preview's address is a member's, so no link on it says where it was.
      audience: 'private',
      // The site's search answers for what is published; a preview of what
      // may not be has nothing it could honestly search.
      searchHref: null,
      sections: preview.sections.map((section) =>
        navigationSection({
          name: section.collection.name,
          nodes: section.navigation,
          hrefOf: (node) => readerPreviewHref(node.path),
          currentDocumentId: document.id,
          open: section.collection.id === collection.id,
        }),
      ),
      title: `Preview: ${document.title}`,
      description: null,
      canonical: null,
      robots: NOT_FOR_INDEXING,
      stylesheetHref: stylesheet.href,
      themeId: stylesheet.identity,
      htmlAttributes: pageLayoutAttributes([
        organisation.layout.default,
        organisation.theme.variants,
      ]),
      scriptHref: schemeScript.href,
      readerHref: readerScript.href,
      outline: rendered.kind === 'rendered' ? rendered.content.outline : [],
      main:
        rendered.kind === 'rendered'
          ? renderDocumentMain({
              collectionName: collection.name,
              title: document.title,
              bodyHtml,
              rules: organisation.layout.default.rules,
              byline:
                facts === null
                  ? undefined
                  : html`${renderByline({ facts, tagHref: null })}${notice}`,
            })
          : renderUnpublishedMain({ collectionName: collection.name, title: document.title }),
      updatedAt,
      structuredData: null,
      query: null,
      preview: renderPreviewBanner({
        closeHref: `/w/${workspace.slug}/d/${documentReference(document)}`,
        publicHref,
      }),
    })
  }

  return async (rawApp) => {
    const app = rawApp.withTypeProvider<TypeBoxTypeProvider>()

    app.get(
      `${READER_PREVIEW_PREFIX}/:documentRef`,
      {
        // Read when there is one, so a request without a session can be sent
        // to sign in rather than answered with the API's JSON 401.
        preHandler: app.optionalSession,
        schema: { params: PreviewParams, hide: true },
      },
      async (request, reply) => {
        privately(reply)
        if (request.session === undefined) {
          const back = readerPreviewHref(request.params.documentRef)
          return reply.redirect(`/sign-in?redirect=${encodeURIComponent(back)}`, 303)
        }

        const documentId = await documentIdOf(request.params.documentRef)
        if (documentId === null) return nothingToPreview(reply)

        const authorizer = authorizerFor(deps, request)
        const access = await authorizer.document(documentId)
        if (!access.ok && access.error.kind === 'document-not-found') return nothingToPreview(reply)
        if (access.ok && !access.value.capabilities.view) return nothingToPreview(reply)
        // Anything else is the tenancy tree contradicting itself, which the
        // shared mapping answers as the server fault it is.
        const granted = await requireDocumentAccess(authorizer, documentId, 'view')

        const loaded = await loadReaderPreview(deps, {
          documentId,
          identities: await authorizer.identities(),
          seesEverything: granted.isInstanceAdmin,
        })
        switch (loaded.kind) {
          case 'preview':
            return sendHtml(
              reply,
              200,
              await pageOf(loaded.preview, {
                kind: 'reader',
                identities: await authorizer.identities(),
                seesEverything: granted.isInstanceAdmin,
              }),
            )
          /* v8 ignore next 2 -- the authorizer has just loaded this document. */
          case 'not-found':
            return nothingToPreview(reply)
          case 'settings-unreadable':
            throw conflict('settings_unreadable', 'The organisation’s settings cannot be read')
          /* v8 ignore next 2 -- the authorizer walked the same tree a moment ago. */
          case 'broken-tree':
            throw new AppError(500, 'broken_tenancy_tree', 'The workspace cannot be placed')
        }
      },
    )
  }
}

function* flatten(nodes: readonly PublicNavigationNode[]): Generator<PublicNavigationNode> {
  for (const node of nodes) {
    yield node
    yield* flatten(node.children)
  }
}
