import { LinkPreviewRetryLater } from '@quill/application'
import type {
  Clock,
  ConnectorCredentialSource,
  ConnectorCredentials,
  ConnectorDraft,
  ConnectorFailure,
  LinkConnector,
  LinkConnectorRegistry,
} from '@quill/application'
import { FILE_MEDIA_TYPE_PATTERNS, err, fileKindOf, normaliseUrl, ok } from '@quill/domain'
import type {
  CompiledLinkPolicy,
  EmbedRegistry,
  LinkPreview,
  LinkPreviewFailure,
  LinkPreviewKind,
  PreviewImage,
  Result,
} from '@quill/domain'

import { decodeHtml } from '../http/decode-html.ts'
import { OPEN_WEB_LIMITS, pageOrFileRequest } from '../http/open-web-client.ts'
import type { OpenWebReader, OpenWebResponse, UrlPermit } from '../http/open-web-client.ts'
import { OutboundRequestError } from '../http/outbound-client.ts'
import { fileNameOf } from './file-name.ts'
import type { ImageIngestor } from './image-ingestor.ts'
import { FAVICON_SPEC, THUMBNAIL_SPEC } from './image-transcoder.ts'
import { MARKUP_LAYERS } from './markup-layers.ts'
import { fetchOembedDraft } from './oembed-layer.ts'
import type { OembedRegistry } from './oembed-registry.ts'
import { extractPageMetadata } from './page-metadata.ts'
import type { PageMetadata } from './page-metadata.ts'
import { SITE_NAME_LIMIT, cleanText } from './plain-text.ts'
import { hasTitle, isRich } from './preview-draft.ts'
import type { PreviewDraft, TitledDraft } from './preview-draft.ts'

/**
 * Resolves a URL to a `LinkPreview` (ADR-042): the layered resolution, the one
 * place that knows the order.
 *
 * 0. **A file.** The one request that fetches the page is also how a file is
 *    recognised: its media type, from the headers, before any body is read. A
 *    PDF, a video, a document or a picture is answered from those headers alone
 *    (type, size, name) and no body is read; only a raster picture is fetched a
 *    second time, through the image pipeline, to store a thumbnail.
 * 1. **A known oEmbed provider**, asked directly, before the page is fetched.
 * 2. **The page itself**, fetched once and shared: Open Graph, then Twitter
 *    Card, then its own tags and JSON-LD.
 * 3. **The oEmbed endpoint the page advertises**, only if nothing above was
 *    rich. This is the one place the order departs from a literal reading of
 *    the ADR, and it is a deliberate one: discovery costs a second request to
 *    the host, and for the common page that already has Open Graph it would
 *    return less than we already hold.
 *
 * The first rich draft wins and later layers are never run, so the cost of a
 * preview is the cost of the first layer that answers well. If no layer is rich
 * but one has a title, the first of those is used: a title and a site name are
 * still a better link than none.
 *
 * **Layer 1, a connector's API**, runs before all of these when a connector claims
 * the link (`connectors`). A connector that cannot answer (`not_found`, `unavailable`)
 * hands over to the page layers, so a reader never sees a connector's error. Three
 * outcomes do not fall through, because the page layers would answer wrongly: the
 * content is `restricted` (not public, so no preview; the page would only offer a
 * sign-in screen), the API said to wait (the fetch is deferred with `LinkPreviewRetryLater`,
 * never counted as a failure), and the organisation's policy forbids the host (decided
 * before any layer is asked).
 *
 * Pattern: the layers are strategies tried in order. This function owns the
 * order and the shared page fetch, and each layer owns its own vocabulary.
 */

export interface ResolveOptions {
  /**
   * The organisation's policy. It is enforced on every request the resolution
   * makes (the page, each redirect, an oEmbed endpoint, each image), so a
   * redirect or a page that points at a blocked host does not walk around it.
   * Without one, anything public may be contacted.
   */
  readonly policy?: CompiledLinkPolicy
}

export interface LinkPreviewProvider {
  /**
   * Never throws for an expected outcome. A failure is a value, because every
   * failure but `busy` is an answer the cache stores. The one exception is a
   * connector's rate limit, which throws `LinkPreviewRetryLater`: it says nothing
   * about the link, so the fetch is put back, not stored.
   */
  resolve(
    rawUrl: string,
    options?: ResolveOptions,
  ): Promise<Result<LinkPreview, LinkPreviewFailure>>
}

/** What one resolution may do: which URLs it may contact and whether it may fetch pictures. */
interface Scope {
  readonly permit: UrlPermit | undefined
  readonly images: boolean
  /**
   * Whether a live frame may be recorded. It is the same permission as pictures, `rich`: a
   * frame loads the provider's own page in the reader's browser, which is more than a
   * picture does, so an organisation that has asked for text only never gets one.
   */
  readonly embeds: boolean
}

export interface LinkPreviewProviderDeps {
  readonly reader: OpenWebReader
  readonly images: ImageIngestor
  readonly oembed: OembedRegistry
  /** The embed allowlist as this instance runs it: which pages may become a live frame. */
  readonly embeds: EmbedRegistry
  readonly clock: Clock
  /** Layer 1. Without a registry no connector is consulted. */
  readonly connectors?: LinkConnectorRegistry
  /** Where a connector's credentials come from. Without one connectors act anonymously. */
  readonly credentials?: ConnectorCredentialSource
}

/**
 * Longest a connector may take in all, across every request it makes. Past it the
 * page layers answer: a slow API must not hold a fetch slot for long.
 */
export const CONNECTOR_BUDGET_MS = 10_000

interface FetchedPage {
  readonly metadata: PageMetadata
  /** Where the fetch ended up, after redirects: what relative URLs in the page are relative to. */
  readonly finalUrl: string
}

/** A link to a file: what its headers said, and where the fetch ended up. */
interface FetchedFile {
  readonly response: OpenWebResponse
}

type PageOutcome = Result<
  { readonly page: FetchedPage } | { readonly file: FetchedFile },
  LinkPreviewFailure
>

/** Reasons that mean this is not a URL a preview can ever be made for. */
const UNPREVIEWABLE: ReadonlySet<string> = new Set([
  'scheme_not_allowed',
  'credentials_in_url',
  'port_not_allowed',
  'invalid_url',
])

/** The page answered, but with something that is not a page. */
const NOT_A_PAGE: ReadonlySet<string> = new Set([
  'content_type_not_allowed',
  'content_encoding_not_allowed',
  'response_too_large',
])

function failureFor(error: unknown): LinkPreviewFailure {
  if (!(error instanceof OutboundRequestError)) return 'unreachable'
  if (UNPREVIEWABLE.has(error.reason)) return 'invalid_url'
  if (error.reason === 'blocked_by_policy') return 'blocked'
  if (error.reason === 'too_busy') return 'busy'
  if (NOT_A_PAGE.has(error.reason)) return 'not_a_page'
  return 'unreachable'
}

/**
 * Not found and gone are properties of the link; being refused, throttled or
 * failed are properties of the moment, and read as the host being out of reach.
 */
function failureForStatus(status: number): LinkPreviewFailure {
  return status === 401 || status === 403 || status === 429 || status >= 500
    ? 'unreachable'
    : 'not_a_page'
}

/** What only a connector can add to a preview; all optional, so a page's preview is as it always was. */
type ConnectorExtensions = Partial<Pick<LinkPreview, 'status' | 'embed' | 'file' | 'code'>>

function extensionsOf(draft: ConnectorExtensions): ConnectorExtensions {
  return {
    ...(draft.status === undefined ? {} : { status: draft.status }),
    ...(draft.embed === undefined ? {} : { embed: draft.embed }),
    ...(draft.file === undefined ? {} : { file: draft.file }),
    ...(draft.code === undefined ? {} : { code: draft.code }),
  }
}

/** The pictures the image pipeline reads; SVG is inert and never drawn, so it never gets a thumbnail. */
const RASTER_IMAGES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])
const IMAGE_CAP_BYTES = OPEN_WEB_LIMITS.imageMiB * 1024 * 1024

/** A picture worth fetching again: one the pipeline reads, which the host does not say is over the cap. */
function worthAThumbnail(mediaType: string, declaredBytes: number | null): boolean {
  return (
    RASTER_IMAGES.has(mediaType) && (declaredBytes === null || declaredBytes <= IMAGE_CAP_BYTES)
  )
}

function previewKindOfFile(mediaType: string): LinkPreviewKind {
  const kind = fileKindOf(mediaType)
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'website'
}

function hostWithoutWww(url: string): string {
  return new URL(url).hostname.replace(/^www\./u, '')
}

/** A page may say it is another page on the same site, and may not say it is a page on another. */
function sameSite(claimed: string, actual: string): boolean {
  return hostWithoutWww(claimed) === hostWithoutWww(actual)
}

async function fetchPage(
  reader: OpenWebReader,
  url: string,
  permit: UrlPermit | undefined,
): Promise<PageOutcome> {
  try {
    const response = await reader.get({
      ...pageOrFileRequest(url, FILE_MEDIA_TYPE_PATTERNS),
      permit,
    })
    if (response.status < 200 || response.status > 299)
      return err(failureForStatus(response.status))
    // A file is answered from its headers: the client has already left its body unread.
    if (fileKindOf(response.mediaType) !== null) return ok({ file: { response } })
    // A JSON answer was accepted so the oEmbed layer could share this client; as a page it is nothing.
    if (response.mediaType === 'application/json') return err('not_a_page')
    const html = decodeHtml(response.body, response.charset)
    return ok({
      page: { metadata: extractPageMetadata(html, response.url), finalUrl: response.url },
    })
  } catch (error) {
    return err(failureFor(error))
  }
}

export function createLinkPreviewProvider(deps: LinkPreviewProviderDeps): LinkPreviewProvider {
  const { reader, images, oembed, embeds, clock, connectors, credentials } = deps

  /** Credentials at the moment of use; a source that fails means anonymous, never a failed preview. */
  async function credentialsFor(connector: LinkConnector): Promise<ConnectorCredentials | null> {
    if (credentials === undefined) return null
    try {
      return await credentials.forConnector(connector)
    } catch {
      return null
    }
  }

  /**
   * Asks the connector, and answers a draft, or the failure that decides what happens
   * next. A connector that throws has broken its contract and is treated as unavailable.
   */
  async function askConnector(
    connector: LinkConnector,
    target: URL,
  ): Promise<Result<ConnectorDraft, ConnectorFailure>> {
    const budget = new AbortController()
    const timer = setTimeout(() => {
      budget.abort()
    }, CONNECTOR_BUDGET_MS)
    try {
      return await connector.resolve(target, await credentialsFor(connector), budget.signal)
    } catch {
      return err({ kind: 'unavailable' })
    } finally {
      clearTimeout(timer)
    }
  }

  /** The first favicon candidate that turns into an image; later ones are the fallback, so one at a time. */
  async function firstFavicon(
    page: FetchedPage | null,
    scope: Scope,
  ): Promise<PreviewImage | null> {
    if (!scope.images) return null
    for (const icon of page?.metadata.icons ?? []) {
      // eslint-disable-next-line no-await-in-loop -- a fallback chain: the next is fetched only if this one fails.
      const image = await images.ingest(icon.href, FAVICON_SPEC, scope.permit)
      if (image !== null) return image
    }
    return null
  }

  async function assemble(
    key: string,
    draft: TitledDraft,
    page: FetchedPage | null,
    scope: Scope,
    extensions: ConnectorExtensions = {},
  ): Promise<LinkPreview> {
    const [thumbnail, favicon] = await Promise.all([
      draft.imageUrl === null || !scope.images
        ? null
        : images.ingest(draft.imageUrl, THUMBNAIL_SPEC, scope.permit),
      firstFavicon(page, scope),
    ])
    const where = page?.finalUrl ?? key
    const claimed = draft.canonicalUrl ?? page?.metadata.canonicalUrl ?? null
    // The page's claim is believed only for its own site; otherwise the address is where we ended up.
    const address = claimed !== null && sameSite(claimed, where) ? claimed : where
    const canonicalUrl = normaliseUrl(address) ?? key
    const frame = scope.embeds ? embeds.find(new URL(key)) : null
    return {
      url: key,
      canonicalUrl,
      title: draft.title,
      description: draft.description,
      // A card always says where it points, even when the page did not say who it is.
      siteName: draft.siteName ?? cleanText(hostWithoutWww(where), SITE_NAME_LIMIT),
      kind: draft.kind,
      thumbnail,
      favicon,
      layer: draft.layer,
      fetchedAt: clock.now().toISOString(),
      // Built by us from the address's validated parts (`embeds.find`), never from the page.
      ...(frame === null
        ? {}
        : {
            embed: {
              provider: frame.provider.id,
              src: frame.frame.src,
              aspectRatio: frame.frame.aspectRatio,
            },
          }),
      ...extensions,
    }
  }

  /**
   * A link to a file: its card is the type, the size and the name its headers gave. A raster
   * picture also gets a thumbnail, through the same pipeline as every other image (isolated
   * decoding, re-encoded, stored by hash, size capped); nothing else is ever downloaded.
   */
  async function assembleFile(
    key: string,
    response: OpenWebResponse,
    scope: Scope,
  ): Promise<LinkPreview> {
    const bytes = response.declaredBytes ?? null
    const name = fileNameOf(response.disposition ?? null, response.url)
    const host = hostWithoutWww(response.url)
    const thumbnail =
      scope.images && worthAThumbnail(response.mediaType, bytes)
        ? await images.ingest(response.url, THUMBNAIL_SPEC, scope.permit)
        : null
    return {
      url: key,
      canonicalUrl: normaliseUrl(response.url) ?? key,
      title: name ?? host,
      description: null,
      siteName: cleanText(host, SITE_NAME_LIMIT),
      kind: previewKindOfFile(response.mediaType),
      thumbnail,
      favicon: null,
      layer: 'page',
      fetchedAt: clock.now().toISOString(),
      file: { mediaType: response.mediaType, bytes, name },
    }
  }

  return {
    async resolve(rawUrl, options = {}) {
      const key = normaliseUrl(rawUrl)
      if (key === null) return err('invalid_url')
      const target = new URL(key)
      const { policy } = options
      // The pasted URL is asked first, on its own: an oEmbed endpoint on another
      // host would otherwise be sent a link the policy forbids contacting.
      if (policy !== undefined && !policy.permits(target)) return err('blocked')
      const scope: Scope = {
        permit: policy === undefined ? undefined : (url) => policy.permits(url),
        images: policy?.images ?? true,
        embeds: policy === undefined || policy.mode === 'rich',
      }
      const drafts: PreviewDraft[] = []
      const finish = async (draft: TitledDraft, page: FetchedPage | null) =>
        ok(await assemble(key, draft, page, scope))

      const connector = connectors?.find(target) ?? null
      if (connector !== null) {
        const answer = await askConnector(connector, target)
        if (answer.ok) {
          const { imageUrl, canonicalUrl, ...connected } = answer.value
          const titled: TitledDraft = {
            layer: 'connector',
            title: connected.title,
            description: connected.description,
            siteName: connected.siteName,
            kind: connected.kind,
            imageUrl,
            canonicalUrl,
          }
          return ok(await assemble(key, titled, null, scope, extensionsOf(connected)))
        }
        // Not public: there is nothing to show, and the page would only offer a sign-in screen.
        if (answer.error.kind === 'restricted') return err('restricted')
        if (answer.error.kind === 'rate_limited') {
          throw new LinkPreviewRetryLater(`${connector.id} rate limit`, answer.error.retryAfterMs)
        }
      }

      const known = oembed.find(target)
      if (known !== null) {
        const draft = await fetchOembedDraft(reader, known.endpointUrl, key, scope.permit)
        if (draft !== null && isRich(draft)) return finish(draft, null)
        if (draft !== null) drafts.push(draft)
      }

      const outcome = await fetchPage(reader, key, scope.permit)
      if (!outcome.ok) {
        // A known provider that gave a title is enough when the page itself cannot be had.
        const fallback = drafts.find(hasTitle)
        return fallback === undefined ? err(outcome.error) : finish(fallback, null)
      }
      if ('file' in outcome.value) {
        return ok(await assembleFile(key, outcome.value.file.response, scope))
      }
      const { page } = outcome.value

      for (const layer of MARKUP_LAYERS) {
        const draft = layer(page.metadata, page.finalUrl)
        if (draft === null) continue
        if (isRich(draft)) return finish(draft, page)
        drafts.push(draft)
      }

      if (page.metadata.oembedUrl !== null) {
        const draft = await fetchOembedDraft(reader, page.metadata.oembedUrl, key, scope.permit)
        if (draft !== null && isRich(draft)) return finish(draft, page)
        if (draft !== null) drafts.push(draft)
      }

      const best = drafts.find(hasTitle)
      return best === undefined ? err('no_metadata') : finish(best, page)
    },
  }
}
