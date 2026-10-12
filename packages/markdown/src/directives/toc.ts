import type { LeafDirective } from 'mdast-util-directive'

import type {
  Directive,
  DirectiveAttributes,
  DirectiveDefinition,
  DirectiveIssue,
} from './definition.ts'
import { integerAttribute, integerIssues, issue } from './definition.ts'

/** HTML has six heading levels; the table of contents can list any run of them. */
export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const

export type HeadingLevel = (typeof HEADING_LEVELS)[number]

const LEVEL_RANGE = { min: 1, max: 6 } as const

/**
 * A document opens with its own title, an `h1`, so listing it would be a link to
 * the first line of the page; the contents start at the sections under it.
 */
export const DEFAULT_TOC_MIN: HeadingLevel = 2
export const DEFAULT_TOC_MAX: HeadingLevel = 3

export interface TableOfContents {
  /** The shallowest heading listed. */
  readonly min: HeadingLevel
  /** The deepest heading listed. */
  readonly max: HeadingLevel
}

export function isHeadingLevel(value: number | undefined): value is HeadingLevel {
  return value !== undefined && (HEADING_LEVELS as readonly number[]).includes(value)
}

type Attributes = DirectiveAttributes | null | undefined

function written(attributes: Attributes, name: string): HeadingLevel | undefined {
  const value = integerAttribute(attributes, name, LEVEL_RANGE)
  return isHeadingLevel(value) ? value : undefined
}

/**
 * The levels a `::toc` lists, from its attributes alone. Taking the attributes
 * rather than a syntax-tree node is what lets the writing surface, which holds
 * them as a plain record, read them with the same defaults and the same
 * correction of a reversed range as the renderer does.
 */
export function tocLevels(attributes: Attributes): TableOfContents {
  const first = written(attributes, 'min') ?? DEFAULT_TOC_MIN
  const last = written(attributes, 'max') ?? DEFAULT_TOC_MAX
  return first <= last ? { min: first, max: last } : { min: last, max: first }
}

/**
 * `::toc{min=2 max=3}` — a table of contents for the document it is in.
 *
 * It is derived from the headings alone, so unlike the live blocks of ADR-032 it
 * stays a pure function of the source and is rendered into the cached body
 * (ADR-031). Outside Quill it reads as its own directive line, which still says
 * what was meant. A range written the wrong way round is read the right way
 * round rather than listing nothing.
 */
export const tocDirective: DirectiveDefinition<TableOfContents, LeafDirective> = {
  names: ['toc'],
  kinds: ['leaf'],

  parse: (node) => tocLevels(node.attributes),

  validate(node: Directive): readonly DirectiveIssue[] {
    const first = written(node.attributes, 'min')
    const last = written(node.attributes, 'max')
    const reversed =
      first !== undefined && last !== undefined && first > last
        ? [
            issue(
              'min',
              `"min" (${String(first)}) is deeper than "max" (${String(last)}); read the other way round.`,
              'warning',
            ),
          ]
        : []
    return [
      ...integerIssues(node.attributes, 'min', LEVEL_RANGE),
      ...integerIssues(node.attributes, 'max', LEVEL_RANGE),
      ...reversed,
    ]
  },

  serialize(model: TableOfContents): LeafDirective {
    return {
      type: 'leafDirective',
      name: 'toc',
      attributes: { min: String(model.min), max: String(model.max) },
      children: [],
    }
  },
}
