import rehypeStringify from 'rehype-stringify'
import { fromHtml } from 'hast-util-from-html'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Element, ElementContent, Properties, Root as HastRoot } from 'hast'
import type { Schema } from 'hast-util-sanitize'

import type { ChildPagesBlock, ChildPagesQuery } from './children.ts'
import {
  CHILD_PAGES_BLOCK,
  CHILD_PAGES_SLOT_KEY,
  childPagesSlotKey,
  parseChildPagesSlotKey,
} from './children.ts'
import type { TableOfContents, TocEntry } from './toc.ts'
import { TOC_STYLES } from './toc.ts'

/**
 * How the navigation blocks are drawn (ADR-056): one template each, shared by
 * the app, the public site and export (AGENTS.md rule 16).
 *
 * - A **table of contents** is a `nav` named by its title, or "Table of
 *   contents", around a nested list of links to the document's headings. With
 *   `collapsed`, a section's subsections sit in the browser's own `details`
 *   beside its link, never around it, so the link is not inside the control.
 * - **Child pages** are a slot in the body (ADR-032): a `section` carrying the
 *   block type and its key, the title, and a fallback line. Filling it
 *   replaces the fallback with the list, so the title keeps the id the
 *   section is named by.
 */

function element(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

function text(value: string): ElementContent {
  return { type: 'text', value }
}

/** Visually hidden words, said to a screen reader. */
function spoken(value: string): Element {
  return element('span', { className: ['sr-only'] }, [text(value)])
}

/** The title paragraph a block is named by, and how the block refers to it. */
function titled(
  prefix: 'toc' | 'children',
  ordinal: number,
  title: string | undefined,
  fallbackName: string,
): { readonly naming: Properties; readonly heading: ElementContent[] } {
  if (title === undefined) return { naming: { 'aria-label': fallbackName }, heading: [] }
  const id = `${prefix}.${String(ordinal)}`
  return {
    naming: { ariaLabelledBy: [id] },
    heading: [
      element('p', { className: [`${prefix === 'toc' ? 'toc' : 'child-pages'}-title`], id }, [
        text(title),
      ]),
    ],
  }
}

export const TABLE_OF_CONTENTS_LABEL = 'Table of contents'

function tocList(entries: readonly TocEntry[], model: TableOfContents): Element {
  const tag = model.style === 'numbered' ? 'ol' : 'ul'
  return element(
    tag,
    { className: ['toc-list'] },
    entries.map((entry) => {
      const link = element('a', { href: `#${entry.id}` }, [text(entry.text)])
      if (entry.children.length === 0) return element('li', {}, [link])
      const nested = tocList(entry.children, model)
      if (!model.collapsed) return element('li', {}, [link, nested])
      return element('li', {}, [
        link,
        element('details', { className: ['toc-fold'] }, [
          element('summary', {}, [spoken(`Subsections of ${entry.text}`)]),
          nested,
        ]),
      ])
    }),
  )
}

/**
 * A table of contents: its title, and its entries or one quiet line saying
 * there are none. `ordinal` numbers the blocks of one render, so a title's id
 * is the same every time the document is drawn (ADR-039).
 */
export function tableOfContentsElement(
  model: TableOfContents,
  entries: readonly TocEntry[],
  ordinal: number,
): Element {
  const { naming, heading } = titled('toc', ordinal, model.title, TABLE_OF_CONTENTS_LABEL)
  const body =
    entries.length === 0
      ? element('p', { className: ['toc-empty'] }, [
          text(
            model.levels.from === model.levels.to
              ? `No level ${String(model.levels.from)} headings yet.`
              : `No headings at levels ${String(model.levels.from)}–${String(model.levels.to)} yet.`,
          ),
        ])
      : tocList(entries, model)
  return element(
    'nav',
    {
      className: ['toc'],
      'data-style': model.style,
      ...(model.collapsed ? { 'data-collapsed': '' } : {}),
      ...naming,
    },
    [...heading, body],
  )
}

export const CHILD_PAGES_LABEL = 'Child pages'

export const CHILD_PAGES_FALLBACK = 'The pages under this one are listed here.'

/** The slot a `::children` block is drawn as in the cached body. */
export function childPagesSlotElement(model: ChildPagesBlock, ordinal: number): Element {
  const { naming, heading } = titled('children', ordinal, model.title, CHILD_PAGES_LABEL)
  return element(
    'section',
    {
      className: ['live-block', 'child-pages'],
      'data-live-block': CHILD_PAGES_BLOCK,
      'data-live-key': childPagesSlotKey(model),
      ...naming,
    },
    [
      ...heading,
      element('p', { className: ['child-pages-fallback'] }, [text(CHILD_PAGES_FALLBACK)]),
    ],
  )
}

/** One page in a child pages list, as the page assembling it found it. */
export interface ChildPage {
  readonly id: string
  readonly title: string
  /** Where the page is read, in the surface's own addresses. */
  readonly href: string
  /** Not yet published: listed for those who can read drafts, with a badge saying so. */
  readonly draft: boolean
  readonly excerpt: string | undefined
  /** The page's own icon, an emoji; a page glyph is drawn when there is none. */
  readonly icon: string | undefined
  readonly children: readonly ChildPage[]
}

export const NO_CHILD_PAGES = 'No child pages yet'

function childPageItem(page: ChildPage, query: ChildPagesQuery): Element {
  const icon = query.icons
    ? [
        page.icon === undefined
          ? element(
              'span',
              { className: ['child-page-icon'], 'data-icon': 'page', 'aria-hidden': 'true' },
              [],
            )
          : element('span', { className: ['child-page-icon'], 'aria-hidden': 'true' }, [
              text(page.icon),
            ]),
      ]
    : []
  const badge = page.draft
    ? [element('span', { className: ['badge'], 'data-tone': 'neutral' }, [text('Draft')])]
    : []
  const excerpt =
    query.excerpts && page.excerpt !== undefined
      ? [element('p', { className: ['child-page-excerpt'] }, [text(page.excerpt)])]
      : []
  const nested = page.children.length === 0 ? [] : [childPagesList(page.children, query)]
  return element('li', { className: ['child-page'] }, [
    element('a', { className: ['child-page-link'], href: page.href }, [
      ...icon,
      element('span', { className: ['child-page-title'] }, [text(page.title)]),
    ]),
    ...badge,
    ...excerpt,
    ...nested,
  ])
}

function childPagesList(pages: readonly ChildPage[], query: ChildPagesQuery): Element {
  return element(
    'ul',
    { className: ['child-pages-list'] },
    pages.map((page) => childPageItem(page, query)),
  )
}

/**
 * What fills a child pages slot: the list, nested as deep as it was asked
 * for, or the empty state. The pages arrive already filtered to what this
 * reader may see, sorted and cut to depth; this only draws them.
 */
export function childPagesFill(pages: readonly ChildPage[], query: ChildPagesQuery): Element {
  return pages.length === 0
    ? element('p', { className: ['child-pages-empty'] }, [text(NO_CHILD_PAGES)])
    : childPagesList(pages, query)
}

const stringify = unified().use(rehypeStringify).freeze()

/**
 * A table of contents as HTML, for a surface that draws one outside a body:
 * the editor's live preview, which must look exactly like what the reader
 * will be shown. The title's id is the one a body's first contents gets.
 */
export function renderTableOfContents(
  model: TableOfContents,
  entries: readonly TocEntry[],
): string {
  return stringify.stringify({
    type: 'root',
    children: [tableOfContentsElement(model, entries, 1)],
  })
}

/** `childPagesFill` as HTML, for a surface that places it in a slot it already shows. */
export function renderChildPages(pages: readonly ChildPage[], query: ChildPagesQuery): string {
  return stringify.stringify({ type: 'root', children: [childPagesFill(pages, query)] })
}

function hasClass(node: Element, name: string): boolean {
  const classes = node.properties['className']
  return Array.isArray(classes) && classes.includes(name)
}

/** The child pages slots a body holds, with the query each one asks. */
export function childPagesQueries(html: string): readonly ChildPagesQuery[] {
  if (!html.includes(`data-live-block="${CHILD_PAGES_BLOCK}"`)) return []
  const found = new Map<string, ChildPagesQuery>()
  visit(fromHtml(html, { fragment: true }), 'element', (node: Element) => {
    const key = slotKeyOf(node)
    const query = key === undefined ? undefined : parseChildPagesSlotKey(key)
    if (key !== undefined && query !== undefined) found.set(key, query)
  })
  return [...found.values()]
}

function slotKeyOf(node: Element): string | undefined {
  if (node.tagName !== 'section' || node.properties['dataLiveBlock'] !== CHILD_PAGES_BLOCK)
    return undefined
  const key = node.properties['dataLiveKey']
  return typeof key === 'string' ? key : undefined
}

/**
 * A body with every child pages slot filled, for a surface that assembles
 * the page on the server (the public site, export). `pagesFor` answers each
 * distinct query once. A slot whose key names no query is left as its
 * fallback, which is what a reader of a newer document on an older server
 * should see (ADR-033).
 */
export function fillChildPagesSlots(
  html: string,
  pagesFor: (query: ChildPagesQuery) => readonly ChildPage[],
): string {
  if (!html.includes(`data-live-block="${CHILD_PAGES_BLOCK}"`)) return html
  const tree: HastRoot = fromHtml(html, { fragment: true })
  const answers = new Map<string, readonly ChildPage[]>()
  visit(tree, 'element', (node: Element) => {
    const key = slotKeyOf(node)
    const query = key === undefined ? undefined : parseChildPagesSlotKey(key)
    if (key === undefined || query === undefined) return
    const pages = answers.get(key) ?? pagesFor(query)
    answers.set(key, pages)
    node.children = node.children.map((child) =>
      child.type === 'element' && hasClass(child, 'child-pages-fallback')
        ? childPagesFill(pages, query)
        : child,
    )
  })
  return stringify.stringify(tree)
}

/**
 * What the navigation blocks need from the body's sanitiser (ADR-039, "The
 * sanitiser runs last"), and nothing more: the `nav` element, each block's
 * classes, a contents list's style, and the ids that name a block, each in
 * exactly the shape this module writes. A filled child pages list is drawn
 * after sanitising, on the server, from text it escapes, so it needs no grant.
 */
export const NAVIGATION_SANITIZE_GRANT: {
  readonly tagNames: readonly string[]
  readonly classes: Readonly<
    Record<'nav' | 'p' | 'list' | 'details' | 'section', readonly string[]>
  >
  readonly attributes: Readonly<
    Record<'nav' | 'section', NonNullable<Schema['attributes']>[string]>
  >
} = {
  tagNames: ['nav'],
  classes: {
    nav: ['toc'],
    p: ['toc-title', 'toc-empty', 'child-pages-title', 'child-pages-fallback'],
    list: ['toc-list'],
    details: ['toc-fold'],
    section: ['child-pages'],
  },
  attributes: {
    nav: [
      ['data-style', ...TOC_STYLES],
      ['data-collapsed', ''],
      ['aria-label', TABLE_OF_CONTENTS_LABEL],
      ['ariaLabelledBy', /^toc\.\d{1,4}$/],
    ],
    section: [
      ['data-live-key', CHILD_PAGES_SLOT_KEY],
      ['ariaLabelledBy', /^children\.\d{1,4}$/],
    ],
  },
}
