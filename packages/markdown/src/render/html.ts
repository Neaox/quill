import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import type { Element, ElementContent, Root as HastRoot } from 'hast'
import type { Root } from 'mdast'

import { stripPresenterNotes } from '../directives/strip-presenter-notes.ts'
import { escapeRawHtml } from './escape-raw-html.ts'
import { addExternalLinkRel } from './external-link-rel.ts'
import type { Highlighter } from './handlers.ts'
import { createHandlers } from './handlers.ts'
import type { OutlineEntry } from './outline.ts'
import { extractOutline } from './outline.ts'
import { sanitizeSchema } from './sanitize-schema.ts'
import { createSlugger } from './slug.ts'

/**
 * The serialiser, built once: it holds no per-document state, and building a
 * unified pipeline is the expensive part of using one.
 *
 * `allowDangerousHtml` is `false` (the default): a `raw` node this far into the
 * pipeline would be a bug, not untrusted input — every one was already turned
 * into text by `escapeRawHtml` — so there is nothing left that should ever be
 * emitted unescaped.
 */
const stringify = unified().use(rehypeStringify, { allowDangerousHtml: false }).freeze()

export interface RenderOptions {
  /**
   * Highlighting is injected, never imported (ADR-030): this package owns no
   * grammars. It returns packed token ranges for `data-tokens`, or null when the
   * block is left for the client to highlight on demand.
   */
  readonly highlighter?: Highlighter | undefined
  /** Document metadata, so dates are rendered as `time` in the document header. */
  readonly frontMatter?: Record<string, unknown> | undefined
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?$/

interface DateField {
  readonly path: string
  readonly value: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Walks front matter lazily, yielding every field that reads as a date. */
function* dateFields(value: unknown, path: string): Generator<DateField> {
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) yield { path, value }
    return
  }
  if (!isRecord(value)) return
  for (const [key, nested] of Object.entries(value)) {
    yield* dateFields(nested, path === '' ? key : `${path}.${key}`)
  }
}

function element(
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[],
): Element {
  return { type: 'element', tagName, properties, children }
}

function documentHeader(frontMatter: Record<string, unknown> | undefined): ElementContent[] {
  const fields = [...dateFields(frontMatter, '')]
  if (fields.length === 0) return []
  const rows = fields.map((field) =>
    element('div', {}, [
      element('dt', {}, [{ type: 'text', value: field.path }]),
      element('dd', {}, [
        element('time', { dateTime: field.value }, [{ type: 'text', value: field.value }]),
      ]),
    ]),
  )
  return [element('header', { className: ['document-meta'] }, [element('dl', {}, rows)])]
}

/**
 * Renders a document to semantic, accessible HTML: one `article`, headings that
 * can be linked to, tables with real header cells, figures with captions, callouts
 * that announce themselves, and code blocks ready for the highlighting the reader
 * applies after hydration (ADR-023, ADR-030).
 *
 * Sanitisation is this function's own job, not a downstream caller's (ADR-011
 * "Input, output, and content"): raw HTML written by an author is escaped to
 * visible text rather than parsed or executed (`escape-raw-html.ts` explains why),
 * every element and attribute the result can carry is checked against
 * `sanitize-schema.ts`'s allowlist, and external links are given
 * `rel="noopener noreferrer"`. This runs on every call, on the server, before the
 * caller can put the result anywhere — including the render cache (ADR-031).
 */
export function renderHtml(ast: Root, options: RenderOptions = {}): string {
  const toHast = unified()
    .use(remarkRehype, {
      handlers: createHandlers({ slug: createSlugger(), highlighter: options.highlighter }),
      // Required for raw HTML to reach the hast tree at all (`escape-raw-html.ts`);
      // it does not by itself make anything unsafe, because nothing downstream is
      // told to trust a `raw` node as real markup (see `stringify` below).
      allowDangerousHtml: true,
    })
    .freeze()

  // Presenter notes survive a publish so presentation mode can read the
  // source; the rendered body is what readers see, so they are removed before
  // the tree is rendered rather than by a handler, and the outline is taken
  // from the same reduced tree (`extractOutline`) so heading ids still match.
  const hast: HastRoot = toHast.runSync(stripPresenterNotes(ast))
  const body = hast.children.filter((child): child is ElementContent => child.type !== 'doctype')
  const article = element('article', {}, [...documentHeader(options.frontMatter), ...body])
  const document: HastRoot = { type: 'root', children: [article] }

  const safe = addExternalLinkRel(rehypeSanitize(sanitizeSchema)(escapeRawHtml(document)))
  return stringify.stringify(safe)
}

export interface RenderedDocument {
  readonly html: string
  /** Heading ids that resolve against `html`, because both came from this tree. */
  readonly outline: readonly OutlineEntry[]
}

/**
 * A document's HTML and its table of contents, taken from one tree.
 *
 * The two have to agree, and they only agree if they see the same headings: a
 * slugger deduplicates, so a heading present in one tree and absent from the
 * other shifts every later `-1` suffix and the table of contents starts pointing
 * at the wrong sections. That is easy to get wrong across a caller that strips
 * authoring blocks before publishing and then extracts an outline from the
 * unstripped draft, so this is the entry point that makes it impossible.
 */
export function renderDocument(ast: Root, options: RenderOptions = {}): RenderedDocument {
  return { html: renderHtml(ast, options), outline: extractOutline(ast) }
}
