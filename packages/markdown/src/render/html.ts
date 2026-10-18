import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Element, ElementContent, Root as HastRoot } from 'hast'
import type { Schema } from 'hast-util-sanitize'
import type { Root } from 'mdast'

import { stripPresenterNotes } from '../directives/strip-presenter-notes.ts'
import type { CustomEmoji, StandardLookup } from '../emoji/emoji.ts'
import { emojiLookup, guardEmojiImages, withEmoji } from '../emoji/emoji.ts'
import type { MarkdownRegistry } from '../extensions/registry.ts'
import { escapeRawHtml } from './escape-raw-html.ts'
import { addExternalLinkRel } from './external-link-rel.ts'
import { prefixFragmentLinks } from './fragment-links.ts'
import type { Handlers, Highlighter } from './handlers.ts'
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
  /**
   * Document metadata. Accepted and not drawn: what a document states about
   * itself is the byline's to show, per reader (ADR-059), never the cached
   * body's. Kept so a caller that still passes it is not refused.
   */
  readonly frontMatter?: Record<string, unknown> | undefined
  /**
   * The SVG drawings the body shows, by the image URL that names each one.
   * An image on its own line whose URL is here is drawn inline, sanitised
   * (`drawing.ts`), instead of being shown as an `<img>`.
   */
  readonly drawings?: ReadonlyMap<string, string> | undefined
  /**
   * The installed Markdown extensions (`createMarkdownRegistry`, ADR-039),
   * built once at the composition root. A drawing one of them claims is drawn
   * as that extension chooses; without them, every drawing is drawn inline as
   * it is.
   */
  readonly extensions?: MarkdownRegistry | undefined
  /**
   * The organisation's label names (ADR-037). A text directive named by one,
   * `:acme[Acme]`, is drawn as a badge carrying `data-label`, which the
   * theme stylesheet colours; any other unknown directive is written back as
   * typed. Without it the renderer behaves exactly as it did before labels.
   */
  readonly labels?: ReadonlySet<string> | undefined
  /**
   * GitHub's shortcodes (ADR-038), `standardEmoji` from
   * `@quill/markdown/emoji-shortcodes`. Injected, like the highlighter, so a
   * bundle that imports this package but never renders on the server does
   * not carry the table; without it only custom emoji are drawn.
   */
  readonly standardEmoji?: StandardLookup | undefined
  /**
   * The organisation's own emoji, by name (ADR-038): `:acme:` is drawn as
   * its image. A custom name wins where it is also one of GitHub's.
   */
  readonly emoji?: ReadonlyMap<string, CustomEmoji> | undefined
  /**
   * The emoji each label's pill leads with, by label name — a custom emoji's
   * name or one of GitHub's (ADR-038). A label not in it keeps its colour dot.
   */
  readonly labelEmoji?: ReadonlyMap<string, string> | undefined
}

function element(
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[],
): Element {
  return { type: 'element', tagName, properties, children }
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
  return renderHtmlWith(ast, options, {})
}

/**
 * What a renderer built on this one may change, and nothing else: handlers
 * for nodes only it puts in a tree, and the allowlist widened by exactly the
 * attributes those handlers emit. The comparison view (`diff/render.ts`) is
 * the one caller; every document a reader is shown goes through `renderHtml`
 * and the document schema unchanged.
 */
export interface RenderOverrides {
  readonly handlers?: ((handlers: Handlers) => Handlers) | undefined
  readonly schema?: Schema | undefined
}

export function renderHtmlWith(
  ast: Root,
  options: RenderOptions,
  overrides: RenderOverrides,
): string {
  const placed: Element[] = []
  const lookup = emojiLookup(
    options.emoji ?? new Map<string, CustomEmoji>(),
    options.standardEmoji ?? (() => undefined),
  )
  // Taken at most once, and only when a table of contents asks (ADR-058):
  // from the tree the headings are rendered from, so the ids agree.
  let outline: readonly OutlineEntry[] | undefined
  const outlineOf = (): readonly OutlineEntry[] => (outline ??= extractOutline(ast))
  const toHast = unified()
    .use(remarkRehype, {
      handlers: (overrides.handlers ?? ((handlers: Handlers) => handlers))(
        createHandlers({
          slug: createSlugger(),
          highlighter: options.highlighter,
          drawings: options.drawings,
          extensions: options.extensions,
          placed,
          labels: options.labels,
          outline: outlineOf,
          labelEmoji: (label) => {
            const name = options.labelEmoji?.get(label)
            return name === undefined ? undefined : lookup(name)
          },
        }),
      ),
      // The sanitiser prefixes every id exactly once (`sanitize-schema.ts`), so
      // the footnote ids this step mints are left bare; prefixing them here as
      // well gave `user-content-user-content-fn-1`, and every footnote link
      // pointed at an id that did not exist. `fragment-links.ts` points the
      // links at the prefixed ids.
      clobberPrefix: '',
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
  const hast: HastRoot = toHast.runSync(withEmoji(stripPresenterNotes(ast), lookup))
  const body = hast.children.filter((child): child is ElementContent => child.type !== 'doctype')
  const article = element('article', {}, body)
  const document: HastRoot = { type: 'root', children: [article] }

  const safe = addExternalLinkRel(
    guardEmojiImages(rehypeSanitize(overrides.schema ?? sanitizeSchema)(escapeRawHtml(document))),
  )
  return stringify.stringify(placeDrawings(prefixFragmentLinks(safe), placed))
}

function isDrawingSlot(node: Element): boolean {
  const classes = node.properties['className']
  return (
    node.tagName === 'div' &&
    Array.isArray(classes) &&
    classes.includes('diagram') &&
    node.properties['data-diagram'] === 'svg'
  )
}

/**
 * Fills each drawing slot with its drawing, in document order, after the
 * document has been sanitised. Only the renderer emits a slot — an author's
 * raw HTML was escaped to text before sanitising — and each drawing was
 * sanitised by its own, SVG-only allowlist when it was placed.
 */
function placeDrawings(tree: HastRoot, placed: readonly Element[]): HastRoot {
  if (placed.length === 0) return tree
  const queue = [...placed]
  visit(tree, 'element', (node: Element) => {
    if (isDrawingSlot(node)) node.children = queue.splice(0, 1)
  })
  return tree
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
