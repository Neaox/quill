import { html as htmlSpec, parse } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

/**
 * What a page says about itself, read from the markup (ADR-042).
 *
 * One parse feeds every layer: Open Graph, Twitter Card, the page's own tags,
 * its JSON-LD, its icons and its oEmbed discovery link all sit in the same
 * `<head>`, so each layer reads this rather than re-parsing, and the fetch
 * that produced the HTML is shared too.
 *
 * The parser is parse5, the HTML Standard's own algorithm, because metadata is
 * exactly where hand-rolled regexes fail on real pages: attributes in any
 * order and quoting, entities, a `<meta>` inside `<noscript>`, tags in
 * comments. Values are returned **raw**; they are untrusted and are cleaned by
 * whoever turns them into a preview (`plain-text.ts`).
 */

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

export interface IconCandidate {
  /** Absolute `http(s)` URL. */
  readonly href: string
  /** The larger side the page declared, or 0 when it declared none. */
  readonly size: number
}

export interface JsonLdSummary {
  readonly headline: string | null
  readonly description: string | null
  readonly image: string | null
}

export interface PageMetadata {
  /** The `<title>` element. */
  readonly title: string | null
  /** `<meta name="description">`. */
  readonly description: string | null
  /** `<link rel="canonical">`, absolute. */
  readonly canonicalUrl: string | null
  /** `og:*` properties, by property name, first occurrence winning. */
  readonly openGraph: ReadonlyMap<string, string>
  /** `twitter:*` names, first occurrence winning. */
  readonly twitter: ReadonlyMap<string, string>
  readonly jsonLd: JsonLdSummary | null
  /** Best first: the smallest icon that is at least `PREFERRED_ICON_SIZE`, else the largest. */
  readonly icons: readonly IconCandidate[]
  /** The JSON oEmbed endpoint the page advertises, absolute. */
  readonly oembedUrl: string | null
}

/** A favicon is drawn at 32 CSS pixels; twice that covers a dense display. */
const PREFERRED_ICON_SIZE = 64
const MAX_ICON_CANDIDATES = 3
const MAX_JSON_LD_DEPTH = 4

function isElement(node: Node): node is Element {
  return 'tagName' in node
}

/** Every element in document order, lazily: a caller that finds what it wants stops the walk. */
function* elementsOf(node: Node): Generator<Element> {
  if (!('childNodes' in node)) return
  for (const child of node.childNodes) {
    // Only HTML elements: the `<title>` of an inline SVG is not the page's.
    if (isElement(child) && child.namespaceURI === htmlSpec.NS.HTML) yield child
    yield* elementsOf(child)
  }
}

function attribute(element: Element, name: string): string | null {
  return element.attrs.find((candidate) => candidate.name === name)?.value ?? null
}

function textOf(element: Element): string {
  // `<title>` and `<script>` hold only text in parse5's tree; anything else has no `value` to read.
  /* v8 ignore next */
  return element.childNodes.map((child) => ('value' in child ? child.value : '')).join('')
}

/** An absolute `http(s)` URL resolved against the page, or `null` for anything else. */
export function resolveHttpUrl(reference: string | null, base: string): string | null {
  if (reference === null || reference.trim() === '') return null
  try {
    const url = new URL(reference.trim(), base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function setIfAbsent(map: Map<string, string>, key: string, value: string | null): void {
  if (value !== null && value.trim() !== '' && !map.has(key)) map.set(key, value)
}

/** `sizes="16x16 32x32"` or `"any"`: the largest side declared, 0 for none. */
function declaredSize(sizes: string | null): number {
  const sides = (sizes ?? '').matchAll(/(\d+)x(\d+)/gi)
  return Math.max(0, ...Array.from(sides, (match) => Math.max(Number(match[1]), Number(match[2]))))
}

/** An icon format the image pipeline can read. SVG is refused (ADR-042) and ICO has no decoder. */
function isReadableIcon(href: string, type: string | null): boolean {
  if (type !== null && type !== '' && !/^image\/(png|jpeg|webp|gif)$/i.test(type)) return false
  return !/\.(svg|ico)(?:[?#]|$)/i.test(href)
}

const bySize = (a: IconCandidate, b: IconCandidate) => a.size - b.size

function rankIcons(icons: readonly IconCandidate[]): IconCandidate[] {
  const adequate = icons.filter((icon) => icon.size >= PREFERRED_ICON_SIZE).toSorted(bySize)
  const smaller = icons.filter((icon) => icon.size < PREFERRED_ICON_SIZE).toSorted(bySize)
  // Adequate icons smallest first (least to download); then the rest, biggest first.
  return [...adequate, ...smaller.toReversed()].slice(0, MAX_ICON_CANDIDATES)
}

/** The fields of a JSON-LD node this module reads; anything else on it is ignored. */
interface JsonLdNode {
  readonly headline?: unknown
  readonly description?: unknown
  readonly image?: unknown
  readonly url?: unknown
  readonly '@graph'?: unknown
}

function isRecord(value: unknown): value is JsonLdNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return firstString(value[0])
  if (isRecord(value)) return firstString(value.url)
  return null
}

/** The first node that has a `headline`, searching arrays and `@graph` to a bounded depth. */
function findArticle(value: unknown, depth = 0): JsonLdNode | null {
  if (depth > MAX_JSON_LD_DEPTH) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArticle(item, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  if (!isRecord(value)) return null
  if (typeof value.headline === 'string') return value
  return findArticle(value['@graph'], depth + 1)
}

function summariseJsonLd(source: string): JsonLdSummary | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }
  const article = findArticle(parsed)
  if (article === null) return null
  return {
    headline: firstString(article.headline),
    description: firstString(article.description),
    image: firstString(article.image),
  }
}

/**
 * The most start tags the parser is given.
 *
 * parse5 follows the HTML Standard's tree construction, whose "is this element
 * in scope?" checks walk the stack of open elements, so the cost of a page
 * grows with the square of its nesting. Measured: 10 000 nested elements take
 * half a second, 50 000 take fifteen, 100 000 take forty-seven, all on the one
 * thread that serves every request. A page that is 500 KiB of `<div>` is
 * therefore a denial of service, not a page. Real heads have dozens of tags; a
 * generous 2 000 bounds the work at tens of milliseconds.
 */
const MAX_TAGS = 2000

/**
 * The part of a page worth parsing: everything before the body, and no more
 * than `MAX_TAGS` tags of it. A page's metadata is, by the standard, in its
 * `<head>`; text after the head is the page's content, which a preview never
 * reads, and is where the nesting attack above lives.
 */
export function headMarkup(html: string): string {
  const lower = html.toLowerCase()
  const bounds = [lower.indexOf('</head'), lower.indexOf('<body')].filter((index) => index !== -1)
  let end = bounds.length === 0 ? html.length : Math.min(...bounds)
  let tags = 0
  for (let at = html.indexOf('<'); at !== -1 && at < end; at = html.indexOf('<', at + 1)) {
    tags += 1
    if (tags > MAX_TAGS) {
      end = at
      break
    }
  }
  return html.slice(0, end)
}

export function extractPageMetadata(html: string, pageUrl: string): PageMetadata {
  let title: string | null = null
  let description: string | null = null
  let canonicalUrl: string | null = null
  let oembedUrl: string | null = null
  let jsonLd: JsonLdSummary | null = null
  const openGraph = new Map<string, string>()
  const twitter = new Map<string, string>()
  const icons: IconCandidate[] = []

  for (const element of elementsOf(parse(headMarkup(html)))) {
    switch (element.tagName) {
      case 'title': {
        // The first `<title>` is the document's; an SVG one inside the body is not.
        title ??= textOf(element)
        break
      }
      case 'meta': {
        const content = attribute(element, 'content')
        const property = attribute(element, 'property')?.toLowerCase() ?? null
        const name = attribute(element, 'name')?.toLowerCase() ?? null
        if (property?.startsWith('og:') === true) setIfAbsent(openGraph, property, content)
        // Twitter's own documentation uses `name`, but plenty of pages use `property`.
        for (const key of [name, property]) {
          if (key?.startsWith('twitter:') === true) setIfAbsent(twitter, key, content)
        }
        if (name === 'description') description ??= content
        break
      }
      case 'link': {
        const rel = new Set(attribute(element, 'rel')?.toLowerCase().split(/\s+/u))
        const href = resolveHttpUrl(attribute(element, 'href'), pageUrl)
        if (href === null) break
        if (rel.has('canonical')) canonicalUrl ??= href
        if (
          rel.has('alternate') &&
          attribute(element, 'type')?.toLowerCase() === 'application/json+oembed'
        ) {
          oembedUrl ??= href
        }
        const isIcon =
          rel.has('icon') || rel.has('apple-touch-icon') || rel.has('apple-touch-icon-precomposed')
        if (isIcon && isReadableIcon(href, attribute(element, 'type'))) {
          icons.push({ href, size: declaredSize(attribute(element, 'sizes')) })
        }
        break
      }
      case 'script': {
        if (
          jsonLd === null &&
          attribute(element, 'type')?.toLowerCase() === 'application/ld+json'
        ) {
          jsonLd = summariseJsonLd(textOf(element))
        }
        break
      }
      default:
    }
  }

  return {
    title,
    description,
    canonicalUrl,
    openGraph,
    twitter,
    jsonLd,
    icons: rankIcons(icons),
    oembedUrl,
  }
}
