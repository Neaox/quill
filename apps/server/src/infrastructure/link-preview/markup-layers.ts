import type { LinkPreviewKind } from '@quill/domain'

import { resolveHttpUrl } from './page-metadata.ts'
import type { PageMetadata } from './page-metadata.ts'
import { DESCRIPTION_LIMIT, SITE_NAME_LIMIT, TITLE_LIMIT, cleanText } from './plain-text.ts'
import type { PreviewDraft } from './preview-draft.ts'

/**
 * The three layers that read a page's own markup (ADR-042, layers 3 and 4):
 * Open Graph, then Twitter Card, then the page's plain tags and JSON-LD.
 *
 * Each is a pure function of the metadata already parsed, which is what lets
 * them be tested against recorded pages with no network. They are strategies
 * in the patterns catalogue's sense: the resolver tries them in order and
 * keeps the first rich answer, so each answers only from its own vocabulary.
 *
 * A tag set that has an image or description but no title of its own borrows
 * the page's `<title>`. Pages that tag only an image are common, and a title
 * from the same page is a better card than none.
 */

type MarkupLayer = (page: PageMetadata, pageUrl: string) => PreviewDraft | null

function clean(
  page: PageMetadata,
  pageUrl: string,
  fields: {
    title: string | undefined
    description: string | undefined
    siteName?: string | undefined
    image: string | undefined
  },
): Pick<PreviewDraft, 'title' | 'description' | 'siteName' | 'imageUrl' | 'canonicalUrl'> {
  const hasOtherFields = fields.description !== undefined || fields.image !== undefined
  return {
    title: cleanText(fields.title ?? (hasOtherFields ? page.title : null), TITLE_LIMIT),
    description: cleanText(fields.description, DESCRIPTION_LIMIT),
    siteName: cleanText(fields.siteName, SITE_NAME_LIMIT),
    imageUrl: resolveHttpUrl(fields.image ?? null, pageUrl),
    canonicalUrl: page.canonicalUrl,
  }
}

/** `og:type` is a free-form string; `video.movie` and `music.song` are families. */
function kindFromOpenGraphType(type: string | undefined): LinkPreviewKind {
  const family = type?.toLowerCase().split('.')[0]
  switch (family) {
    case 'article': {
      return 'article'
    }
    case 'video': {
      return 'video'
    }
    case 'music': {
      return 'audio'
    }
    case 'profile': {
      return 'profile'
    }
    default: {
      return 'website'
    }
  }
}

export const openGraphLayer: MarkupLayer = (page, pageUrl) => {
  const tags = page.openGraph
  if (tags.size === 0) return null
  const fields = clean(page, pageUrl, {
    title: tags.get('og:title'),
    description: tags.get('og:description'),
    siteName: tags.get('og:site_name'),
    // `secure_url` is the https twin of `og:image`, offered for mixed-content reasons.
    image: tags.get('og:image') ?? tags.get('og:image:secure_url'),
  })
  const canonicalUrl = resolveHttpUrl(tags.get('og:url') ?? null, pageUrl) ?? fields.canonicalUrl
  return {
    layer: 'open-graph',
    ...fields,
    canonicalUrl,
    kind: kindFromOpenGraphType(tags.get('og:type')),
  }
}

export const twitterCardLayer: MarkupLayer = (page, pageUrl) => {
  const tags = page.twitter
  if (tags.size === 0) return null
  const fields = clean(page, pageUrl, {
    title: tags.get('twitter:title'),
    description: tags.get('twitter:description'),
    image: tags.get('twitter:image') ?? tags.get('twitter:image:src'),
  })
  return {
    layer: 'twitter-card',
    ...fields,
    // `twitter:site` is a handle, not a site name; it is deliberately not read.
    siteName: null,
    kind: tags.get('twitter:card') === 'player' ? 'video' : 'website',
  }
}

/** The page's own tags: `<title>`, the meta description, and JSON-LD, which is the cleanest of them. */
export const pageLayer: MarkupLayer = (page, pageUrl) => {
  const structured = page.jsonLd
  const fields = clean(page, pageUrl, {
    title: structured?.headline ?? page.title ?? undefined,
    description: structured?.description ?? page.description ?? undefined,
    image: structured?.image ?? undefined,
  })
  return {
    layer: 'page',
    ...fields,
    siteName: null,
    kind: structured === null ? 'website' : 'article',
  }
}

/** In the order ADR-042 tries them. */
export const MARKUP_LAYERS: readonly MarkupLayer[] = [openGraphLayer, twitterCardLayer, pageLayer]
