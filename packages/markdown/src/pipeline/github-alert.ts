import type { Blockquote, Paragraph, Root, Text } from 'mdast'
import { visit } from 'unist-util-visit'

import { rewriteTree } from '../tree.ts'
import { rawMdast } from './raw-mdast.ts'

/**
 * GitHub's alert marker, alone on the first line of a blockquote: `> [!NOTE]`.
 * GitHub reads the kind in any case; trailing spaces on the line are allowed.
 */
export const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][^\S\n]*(?:\n|$)/i

export interface AlertOpening {
  readonly paragraph: Paragraph
  readonly text: Text
  /** The marker as written, `[!NOTE]`. */
  readonly marker: string
  /** How many characters of the text are the marker's line, its line ending included. */
  readonly line: number
}

/** The paragraph and text an alert opens with, when the blockquote is one. */
export function alertOpening(node: Blockquote): AlertOpening | undefined {
  const [paragraph] = node.children
  if (paragraph?.type !== 'paragraph') return undefined
  const [text] = paragraph.children
  if (text?.type !== 'text') return undefined
  const match = ALERT_MARKER.exec(text.value)
  if (match === null) return undefined
  return {
    paragraph,
    text,
    marker: text.value.slice(0, text.value.indexOf(']') + 1),
    line: match[0].length,
  }
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
 * Writes each alert's marker unescaped (research 2026-10-11, P0-7).
 *
 * `mdast-util-to-markdown` escapes every `[` in prose, which is right in
 * general and wrong here: `> \[!NOTE]` is still an alert to Quill's renderer
 * but a plain quote to GitHub, GitLab and Obsidian. The marker is moved onto
 * the `rawMdast` escape hatch, so it is written as it reads, only where it is an
 * alert — alone on the first line of a blockquote — and only where it cannot be
 * read back as a reference to a definition named `!note`. A `[!NOTE]` anywhere
 * else is left to the ordinary escaping.
 */
export function withAlertMarkers(tree: Root): Root {
  const defined = definedIdentifiers(tree)
  return rewriteTree(tree, (node) => {
    if (node.type !== 'blockquote') return undefined
    const opening = alertOpening(node)
    if (opening === undefined) return undefined
    const { paragraph, text, marker } = opening
    if (defined.has(marker.slice(1, -1).toLowerCase())) return undefined
    // The spaces GitHub allows after the marker are not kept: nothing reads them.
    const remainder = text.value.slice(marker.length).replace(/^[^\S\n]+/, '')
    const [, ...inline] = paragraph.children
    const body = remainder.length === 0 ? inline : [{ ...text, value: remainder }, ...inline]
    const written: Paragraph = { ...paragraph, children: [rawMdast(marker), ...body] }
    return [{ ...node, children: [written, ...node.children.slice(1)] }]
  })
}
