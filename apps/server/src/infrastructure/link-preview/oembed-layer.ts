import type { LinkPreviewKind } from '@quill/domain'

import { jsonRequest } from '../http/open-web-client.ts'
import type { OpenWebReader, UrlPermit } from '../http/open-web-client.ts'
import { resolveHttpUrl } from './page-metadata.ts'
import { SITE_NAME_LIMIT, TITLE_LIMIT, cleanText } from './plain-text.ts'
import type { PreviewDraft } from './preview-draft.ts'

/**
 * Layer 2 (ADR-042): ask an oEmbed endpoint what a URL is.
 *
 * An endpoint is either a **known provider's**, from the vendored registry, or
 * one the page **advertises** in its own `<head>`. Both answer in the same JSON,
 * so both come here.
 *
 * oEmbed's `html` field, the markup that embeds the content, is **never read**.
 * It is third-party HTML, and the only safe handling is not to handle it: a
 * live embed is built by Quill from an allowlisted provider's own iframe
 * pattern (ADR-042, "Embeds are an allowlist"), never from what an endpoint
 * sends. What this layer takes is text and a thumbnail.
 *
 * An endpoint that fails, answers something that is not JSON, or answers
 * without a title, is not an error: the next layer answers instead.
 */

interface OembedResponse {
  readonly type?: unknown
  readonly title?: unknown
  readonly provider_name?: unknown
  readonly thumbnail_url?: unknown
  /** For a `photo`, the image itself. */
  readonly url?: unknown
}

function isOembedResponse(value: unknown): value is OembedResponse {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

function kindOf(type: unknown): LinkPreviewKind {
  if (type === 'video') return 'video'
  if (type === 'photo') return 'image'
  return 'website'
}

function parse(body: Uint8Array, pageUrl: string): PreviewDraft | null {
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return null
  }
  if (!isOembedResponse(json)) return null

  const isPhoto = json.type === 'photo'
  const thumbnail = resolveHttpUrl(text(json.thumbnail_url), pageUrl)
  return {
    layer: 'oembed',
    title: cleanText(text(json.title), TITLE_LIMIT),
    // oEmbed has no description field; a card from this layer has a title and a picture.
    description: null,
    siteName: cleanText(text(json.provider_name), SITE_NAME_LIMIT),
    kind: kindOf(json.type),
    imageUrl: thumbnail ?? (isPhoto ? resolveHttpUrl(text(json.url), pageUrl) : null),
    canonicalUrl: null,
  }
}

/** The draft an oEmbed endpoint gives for `pageUrl`, or `null` if it gives none. */
export async function fetchOembedDraft(
  reader: OpenWebReader,
  endpointUrl: string,
  pageUrl: string,
  permit?: UrlPermit,
): Promise<PreviewDraft | null> {
  try {
    const response = await reader.get({ ...jsonRequest(endpointUrl), permit })
    return response.status >= 200 && response.status < 300 ? parse(response.body, pageUrl) : null
  } catch {
    // Any failure, from a refused address to a timeout, means this layer has no answer.
    return null
  }
}
