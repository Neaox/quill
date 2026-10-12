import type { Blockquote, Paragraph, PhrasingContent, Root, Text } from 'mdast'
import { visit } from 'unist-util-visit'

import type { CalloutType } from '../directives/callout.ts'
import { DEFAULT_CALLOUT_TYPE, knownCalloutKind } from '../directives/callout.ts'
import { rewriteTree } from '../tree.ts'
import { splitFirstLine } from './first-line.ts'
import { rawMdast } from './raw-mdast.ts'

/**
 * Callouts written as quotes: GitHub's alerts and Obsidian's callouts.
 *
 * ```
 * > [!NOTE]                  GitHub: a kind alone on the first line
 * > Body.
 *
 * > [!tip] Before you begin   Obsidian: a kind of any name, then a title
 * > Body.
 * ```
 *
 * A quote opening with `[!kind]` is a callout, titled by the rest of that line
 * when it has one and by the kind otherwise. Obsidian's foldable form
 * (`[!kind]-`, `[!kind]+`) is a details (`details/read.ts`) and never reaches here.
 * The Markdown is left as written, which is what makes it degrade to a quote
 * everywhere else; only what the document is read as changes.
 */

/** The kinds GitHub has alerts for; the others are Obsidian's, or Quill's own. */
const GITHUB_KINDS: ReadonlySet<string> = new Set([
  'note',
  'tip',
  'important',
  'warning',
  'caution',
])

/** A callout marker opening a quote: `[!kind]`, then a space, a line ending, or nothing. */
const MARKER = /^\[!([A-Za-z][\w-]*)\](?=\s|$)/u

export interface AlertOpening {
  readonly paragraph: Paragraph
  /** The text the marker is at the start of. */
  readonly text: Text
  /** The marker as written, `[!NOTE]`. */
  readonly marker: string
  /** The rest of the marker's line, as inline Markdown: the title, or nothing. */
  readonly title: PhrasingContent[]
  /** What follows that line in the same paragraph: the first words of the body. */
  readonly rest: PhrasingContent[]
  /**
   * The line break that ends the marker's line, as a text node and the index just
   * past the break in it; undefined when the paragraph ends on that line.
   */
  readonly lineEnd: { readonly text: Text; readonly after: number } | undefined
}

/** Inline content without the spaces its last line ends on, which nothing reads. */
function trimEnd(children: PhrasingContent[]): PhrasingContent[] {
  const last = children.at(-1)
  if (last?.type !== 'text') return children
  const value = last.value.trimEnd()
  return value === '' ? children.slice(0, -1) : [...children.slice(0, -1), { ...last, value }]
}

/** Where the first line break after the marker is, as the text node it is in. */
function lineEndOf(paragraph: Paragraph, marker: string): AlertOpening['lineEnd'] {
  for (const [index, child] of paragraph.children.entries()) {
    if (child.type !== 'text') continue
    const from = index === 0 ? marker.length : 0
    const at = child.value.indexOf('\n', from)
    if (at !== -1) return { text: child, after: at + 1 }
  }
  return undefined
}

/** The paragraph, marker, title and body-opening a quote starts with, when it is a callout. */
export function alertOpening(node: Blockquote): AlertOpening | undefined {
  const [paragraph] = node.children
  if (paragraph?.type !== 'paragraph') return undefined
  const [text, ...inline] = paragraph.children
  if (text?.type !== 'text') return undefined
  const match = MARKER.exec(text.value)
  if (match === null) return undefined
  const marker = match[0]
  const afterMarker = text.value.slice(marker.length).replace(/^[^\S\n]+/u, '')
  const split = splitFirstLine([
    ...(afterMarker === '' ? [] : [{ ...text, value: afterMarker }]),
    ...inline,
  ])
  if (split === undefined) return undefined
  return {
    paragraph,
    text,
    marker,
    title: trimEnd(split.line),
    rest: split.rest,
    lineEnd: lineEndOf(paragraph, marker),
  }
}

/** The kind a marker names, as the callout it is drawn as: Quill's, Obsidian's, or a note. */
export function markerType(marker: string): CalloutType {
  return knownCalloutKind(marker.slice(2, -1)) ?? DEFAULT_CALLOUT_TYPE
}

/**
 * The marker a callout made in the editor is written with: GitHub's own capitals
 * for the kinds GitHub has, and Obsidian's lower case for the one it has not
 * (`info`), which is how Obsidian writes every kind.
 */
export function markerOf(type: CalloutType): string {
  return `[!${GITHUB_KINDS.has(type) ? type.toUpperCase() : type}]`
}

/**
 * How a callout was written as a quote, where the callout it is read as cannot
 * say: the marker as typed (`[!Note]`, `[!faq]`), and whether it stood on a
 * paragraph of its own or ran straight into the body's first words. Kept so that
 * it is written back as it was.
 */
export interface AlertForm {
  readonly marker: string
  readonly own: boolean
}

export interface Alert {
  readonly kind: CalloutType
  readonly form: AlertForm
  /** The title the marker's line ends in, as inline Markdown; empty when it has none. */
  readonly title: PhrasingContent[]
  /** The quote's blocks with the marker line taken off. */
  readonly body: Blockquote['children']
}

/** A quote read as the callout it is: its type, how it was written, its title and its body. */
export function splitAlert(node: Blockquote): Alert | undefined {
  const opening = alertOpening(node)
  if (opening === undefined) return undefined
  const { paragraph, marker, title, rest } = opening
  const lead: Paragraph[] = rest.length === 0 ? [] : [{ ...paragraph, children: rest }]
  return {
    kind: markerType(marker),
    form: { marker, own: rest.length === 0 },
    title,
    body: [...lead, ...node.children.slice(1)],
  }
}

/** The marker's own case, so a kind changed in the editor is written as its neighbours were. */
export function markerFor(type: CalloutType, like: string): string {
  const name = like.slice(2, -1)
  const cased =
    name === name.toUpperCase()
      ? type.toUpperCase()
      : name === name.toLowerCase()
        ? type
        : `${type.charAt(0).toUpperCase()}${type.slice(1)}`
  return `[!${cased}]`
}

/** Identifiers of the link reference definitions in a tree (mdast keeps them lower-cased). */
function definedIdentifiers(tree: Root): ReadonlySet<string> {
  const identifiers = new Set<string>()
  visit(tree, 'definition', (node) => {
    identifiers.add(node.identifier)
  })
  return identifiers
}

/**
 * Writes each callout's marker unescaped (research 2026-10-11, P0-7).
 *
 * `mdast-util-to-markdown` escapes every `[` in prose, which is right in
 * general and wrong here: `> \[!NOTE]` is still a callout to Quill's renderer
 * but a plain quote to GitHub, GitLab and Obsidian. The marker is moved onto
 * the `rawMdast` escape hatch, so it is written as it reads, only where it is
 * one — first in a quote — and only where it cannot be read back as a reference
 * to a definition named `!note`. A `[!NOTE]` anywhere else is left to the
 * ordinary escaping.
 */
export function withAlertMarkers(tree: Root): Root {
  const defined = definedIdentifiers(tree)
  return rewriteTree(tree, (node) => {
    if (node.type !== 'blockquote') return undefined
    const opening = alertOpening(node)
    if (opening === undefined) return undefined
    const { paragraph, text, marker } = opening
    if (defined.has(marker.slice(1, -1).toLowerCase())) return undefined
    const [, ...inline] = paragraph.children
    // What follows the marker on its line keeps one space after it, and the spaces
    // before a line break go: nothing reads them.
    const trimmed = text.value.slice(marker.length).replace(/^[^\S\n]+/u, '')
    const [next] = inline
    const joins =
      trimmed === '' && next !== undefined && !(next.type === 'text' && next.value.startsWith('\n'))
    const value = trimmed === '' || trimmed.startsWith('\n') ? trimmed : ` ${trimmed}`
    const after: PhrasingContent[] = joins
      ? [{ ...text, value: ' ' }, ...inline]
      : value === ''
        ? inline
        : [{ ...text, value }, ...inline]
    const written: Paragraph = { ...paragraph, children: [rawMdast(marker), ...after] }
    return [{ ...node, children: [written, ...node.children.slice(1)] }]
  })
}
