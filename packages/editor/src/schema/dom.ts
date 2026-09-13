import type { Attribute, Attributes, Extensions, MarkConfig, NodeConfig } from '@tiptap/core'
import type { DOMOutputSpec, Node as PMNode, TagParseRule } from '@tiptap/pm/model'

import { parseAttribute, renderAttribute } from './attributes.ts'

/**
 * The HTML the Markdown package leaves undeclared.
 *
 * `packages/markdown` owns the schema and nothing else: it builds node specs with
 * no `toDOM` and no `parseDOM`, because the reading surfaces render from mdast and
 * a server has no DOM to render into. ProseMirror needs both — it draws the
 * document through `toDOM` and reads the clipboard through `parseDOM` — so the
 * editor supplies them here, by extending the published extensions rather than by
 * redeclaring a single node.
 *
 * Every node renders as its tag carrying a class of its own name. The class makes
 * each parse rule unambiguous, which a bare tag cannot be: three different nodes
 * render as `pre` and four as `div`. Plain HTML from outside is still understood,
 * through the lower-priority fallback selectors, so pasting a table from a web
 * page produces a table rather than a wall of text.
 */

interface NodeDom {
  readonly tag: string
  /** Wrapped around the content hole, for the `pre > code` of a fenced block. */
  readonly inner?: string
  /** A node with no content renders no content hole. */
  readonly leaf?: boolean
  /** An atom whose meaning is one attribute shows that attribute as its text. */
  readonly text?: string
  /** Selectors for the same construct in HTML that was not written by the editor. */
  readonly fallback?: readonly string[]
  readonly preserveWhitespace?: TagParseRule['preserveWhitespace']
}

/** Lower than ProseMirror's default of 50, so an editor-written element wins. */
const FALLBACK_PRIORITY = 30

const NODE_DOM: Readonly<Record<string, NodeDom>> = {
  paragraph: { tag: 'p', fallback: ['p'] },
  heading: { tag: 'h1' },
  blockquote: { tag: 'blockquote', fallback: ['blockquote'] },
  codeBlock: { tag: 'pre', inner: 'code', fallback: ['pre'], preserveWhitespace: 'full' },
  horizontalRule: { tag: 'hr', leaf: true, fallback: ['hr'] },
  hardBreak: { tag: 'br', leaf: true, fallback: ['br'] },
  bulletList: { tag: 'ul', fallback: ['ul'] },
  orderedList: { tag: 'ol', fallback: ['ol'] },
  taskList: { tag: 'ul' },
  listItem: { tag: 'li', fallback: ['li'] },
  taskItem: { tag: 'li' },
  image: { tag: 'img', leaf: true, fallback: ['img[src]'] },
  table: { tag: 'table', fallback: ['table'] },
  tableRow: { tag: 'tr', fallback: ['tr'] },
  tableCell: { tag: 'td', fallback: ['td'] },
  tableHeader: { tag: 'th', fallback: ['th'] },
  frontMatter: { tag: 'pre', text: 'value', preserveWhitespace: 'full' },
  containerDirective: { tag: 'div' },
  leafDirective: { tag: 'div' },
  textDirective: { tag: 'span' },
  htmlBlock: { tag: 'pre', preserveWhitespace: 'full' },
  htmlInline: { tag: 'span', text: 'value' },
  definition: { tag: 'div', leaf: true },
  footnoteDefinition: { tag: 'section' },
  footnoteReference: { tag: 'sup', leaf: true },
  rawMdast: { tag: 'div', leaf: true },
}

interface MarkDom {
  readonly tag: string
  /** Every selector this mark is recognised by, the editor's own tag included. */
  readonly parse: readonly string[]
}

const MARK_DOM: Readonly<Record<string, MarkDom>> = {
  bold: { tag: 'strong', parse: ['strong', 'b'] },
  italic: { tag: 'em', parse: ['em', 'i'] },
  strike: { tag: 's', parse: ['s', 'del'] },
  code: { tag: 'code', parse: ['code'] },
  link: { tag: 'a', parse: ['a[href]'] },
}

/** The class every element of a given node type carries, and parses back from. */
export function nodeClassName(name: string): string {
  return name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

function htmlAttributes(node: { readonly attrs: Record<string, unknown> }): Record<string, string> {
  return Object.entries(node.attrs).reduce<Record<string, string>>(
    (carried, [name, value]) => ({ ...carried, ...renderAttribute(name, value) }),
    {},
  )
}

/** Headings are the one node whose tag is a property of the node, not of the type. */
function tagOf(name: string, dom: NodeDom, node: PMNode): string {
  return name === 'heading' ? `h${String(node.attrs['level'])}` : dom.tag
}

function renderNode(name: string, dom: NodeDom, node: PMNode): DOMOutputSpec {
  const attributes = { class: nodeClassName(name), ...htmlAttributes(node) }
  const tag = tagOf(name, dom, node)
  if (dom.text !== undefined) return [tag, attributes, String(node.attrs[dom.text])]
  if (dom.leaf === true) return [tag, attributes]
  if (dom.inner !== undefined) return [tag, attributes, [dom.inner, 0]]
  return [tag, attributes, 0]
}

function parseRules(name: string, dom: NodeDom): TagParseRule[] {
  const whitespace =
    dom.preserveWhitespace === undefined ? {} : { preserveWhitespace: dom.preserveWhitespace }
  const own: TagParseRule[] =
    name === 'heading'
      ? [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${String(level)}`, attrs: { level } }))
      : [{ tag: `${dom.tag}.${nodeClassName(name)}`, ...whitespace }]
  const fallbacks = (dom.fallback ?? []).map((tag) => ({
    tag,
    priority: FALLBACK_PRIORITY,
    ...whitespace,
  }))
  return [...own, ...fallbacks]
}

/**
 * Gives every declared attribute a DOM form. Without this an attribute is written
 * with `String(value)`, which turns a directive's attribute record into the text
 * `[object Object]` and corrupts it on the way back in.
 */
function domAwareAttributes(parent: Attributes): Attributes {
  const entries = Object.entries(parent).map(([name, spec]): [string, Attribute] => [
    name,
    {
      ...spec,
      renderHTML: (attrs: Record<string, unknown>) => renderAttribute(name, attrs[name]),
      parseHTML: (element: HTMLElement) => parseAttribute(name, element),
    },
  ])
  return Object.fromEntries(entries)
}

function nodeConfig(name: string, dom: NodeDom): Partial<NodeConfig> {
  return {
    addAttributes() {
      return domAwareAttributes(this.parent?.() ?? {})
    },
    renderHTML: ({ node }) => renderNode(name, dom, node),
    parseHTML: () => parseRules(name, dom),
  }
}

function markConfig(dom: MarkDom): Partial<MarkConfig> {
  return {
    addAttributes() {
      return domAwareAttributes(this.parent?.() ?? {})
    },
    renderHTML: ({ mark }) => [dom.tag, htmlAttributes(mark), 0],
    parseHTML: () => dom.parse.map((tag) => ({ tag })),
  }
}

/**
 * The Markdown package's extensions, each given the HTML it needs to be edited.
 * Node names, content expressions, and attributes are untouched, so the schema the
 * converter targets and the schema the editor runs stay the same schema.
 */
export function withDom(extensions: Extensions): Extensions {
  return extensions.map((extension) => {
    if (extension.type === 'node') {
      const dom = NODE_DOM[extension.name]
      return dom === undefined ? extension : extension.extend(nodeConfig(extension.name, dom))
    }
    if (extension.type === 'mark') {
      const dom = MARK_DOM[extension.name]
      return dom === undefined ? extension : extension.extend(markConfig(dom))
    }
    return extension
  })
}
