import { toString } from 'mdast-util-to-string'
import { CONTINUE, SKIP, visit } from 'unist-util-visit'
import type { Root } from 'mdast'

import { stripAuthoringBlocks } from '../directives/strip-authoring-blocks.ts'
import { stripPresenterNotes } from '../directives/strip-presenter-notes.ts'

export interface DocumentText {
  /** The first level-one heading, or the first heading of any level. */
  readonly title: string | undefined
  readonly headings: readonly string[]
  readonly body: string
}

/** Blocks whose text is worth indexing as prose; everything else is structure. */
const PROSE = new Set(['paragraph', 'code', 'tableCell'])

interface FoundHeading {
  readonly depth: number
  readonly text: string
}

/**
 * The text of a document, for the search index (ADR-010). Authoring scaffolding
 * and presenter notes are excluded, because guidance, placeholders, and what
 * the presenter says aloud are not what the document says.
 */
export function extractText(ast: Root): DocumentText {
  const { ast: published } = stripAuthoringBlocks(stripPresenterNotes(ast))
  const headings: FoundHeading[] = []
  const body: string[] = []

  visit(published, (node) => {
    if (node.type === 'heading') {
      headings.push({ depth: node.depth, text: toString(node) })
      return SKIP
    }
    if (node.type === 'yaml') return SKIP
    if (PROSE.has(node.type)) {
      body.push(toString(node))
      return SKIP
    }
    return CONTINUE
  })

  const title = headings.find((heading) => heading.depth === 1) ?? headings[0]
  return {
    title: title?.text,
    headings: headings.map((heading) => heading.text),
    body: body.join('\n'),
  }
}
