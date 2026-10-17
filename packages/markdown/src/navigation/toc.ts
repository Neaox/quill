import type { LeafDirective } from 'mdast-util-directive'

import type {
  Directive,
  DirectiveAttributes,
  DirectiveDefinition,
  DirectiveIssue,
} from '../directives/definition.ts'
import { attribute, flag, issue, label, textChildren } from '../directives/definition.ts'
import type { OutlineEntry } from '../render/outline.ts'

/**
 * `::toc`: the document's own headings as a list of links (ADR-049).
 *
 * `::toc[On this page]{levels=2-4 style=numbered collapsed}`. The label is an
 * optional title; `levels` the heading levels listed, `N` or `N-M` from 1 to
 * 6; `style` bulleted or numbered; `collapsed` folds every section that has
 * subsections. Anything it cannot read falls back to the default and is
 * reported as a warning, never an error (ADR-002: directives degrade).
 *
 * It is part of the body (ADR-031): its entries are the outline the renderer
 * takes from the same tree as the headings, so every link is the id the
 * heading's own permalink uses.
 */

export const TOC_DIRECTIVE_NAME = 'toc'

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const

export type HeadingLevel = (typeof HEADING_LEVELS)[number]

export interface LevelRange {
  readonly from: HeadingLevel
  readonly to: HeadingLevel
}

export const TOC_STYLES = ['bulleted', 'numbered'] as const

export type TocStyle = (typeof TOC_STYLES)[number]

export interface TableOfContents {
  readonly title: string | undefined
  readonly levels: LevelRange
  readonly style: TocStyle
  readonly collapsed: boolean
}

export const DEFAULT_TABLE_OF_CONTENTS: TableOfContents = {
  title: undefined,
  levels: { from: 2, to: 3 },
  style: 'bulleted',
  collapsed: false,
}

function isHeadingLevel(value: number): value is HeadingLevel {
  return (HEADING_LEVELS as readonly number[]).includes(value)
}

function isTocStyle(value: unknown): value is TocStyle {
  return typeof value === 'string' && (TOC_STYLES as readonly string[]).includes(value)
}

const LEVEL_RANGE = /^\s*(\d)\s*(?:-\s*(\d)\s*)?$/

/** `2-3`, or `4` for one level; undefined when it is no range of heading levels. */
export function parseLevels(value: string): LevelRange | undefined {
  const match = LEVEL_RANGE.exec(value)
  if (match === null) return undefined
  const first = Number(match[1])
  const second = match[2] === undefined ? first : Number(match[2])
  const from = Math.min(first, second)
  const to = Math.max(first, second)
  return isHeadingLevel(from) && isHeadingLevel(to) ? { from, to } : undefined
}

export function formatLevels(levels: LevelRange): string {
  return levels.from === levels.to
    ? String(levels.from)
    : `${String(levels.from)}-${String(levels.to)}`
}

function titleOf(node: Directive): string | undefined {
  const written = label(node)?.trim()
  return written === undefined || written === '' ? undefined : written
}

/**
 * The directive's attributes with the options set as the model says: an
 * option at its default is left out, and every attribute this block does not
 * own is kept as it was (AGENTS.md rule 7).
 */
export function tableOfContentsAttributes(
  attributes: DirectiveAttributes | null | undefined,
  model: TableOfContents,
): Record<string, string> {
  const kept = Object.fromEntries(
    Object.entries(attributes ?? {}).flatMap(([name, value]) =>
      ['levels', 'style', 'collapsed'].includes(name) ? [] : [[name, value ?? '']],
    ),
  )
  const defaults = DEFAULT_TABLE_OF_CONTENTS
  const levels = formatLevels(model.levels)
  return {
    ...kept,
    ...(levels === formatLevels(defaults.levels) ? {} : { levels }),
    ...(model.style === defaults.style ? {} : { style: model.style }),
    ...(model.collapsed ? { collapsed: '' } : {}),
  }
}

export const tocDirective: DirectiveDefinition<TableOfContents, LeafDirective> = {
  names: [TOC_DIRECTIVE_NAME],
  kinds: ['leaf'],

  parse(node: LeafDirective): TableOfContents {
    const levels = attribute(node, 'levels')
    const style = attribute(node, 'style')
    return {
      title: titleOf(node),
      levels:
        (levels === undefined ? undefined : parseLevels(levels)) ??
        DEFAULT_TABLE_OF_CONTENTS.levels,
      style: isTocStyle(style) ? style : DEFAULT_TABLE_OF_CONTENTS.style,
      collapsed: flag(node, 'collapsed'),
    }
  },

  validate(node: Directive): readonly DirectiveIssue[] {
    const levels = attribute(node, 'levels')
    const style = attribute(node, 'style')
    const fallback = formatLevels(DEFAULT_TABLE_OF_CONTENTS.levels)
    return [
      ...(levels === undefined || parseLevels(levels) !== undefined
        ? []
        : [
            issue(
              'levels',
              `Heading levels "${levels}" are not a range from 1 to 6; levels ${fallback} are listed.`,
              'warning',
            ),
          ]),
      ...(style === undefined || isTocStyle(style)
        ? []
        : [issue('style', `Unknown style "${style}"; the list is bulleted.`, 'warning')]),
    ]
  },

  serialize(model: TableOfContents): LeafDirective {
    return {
      type: 'leafDirective',
      name: TOC_DIRECTIVE_NAME,
      attributes: tableOfContentsAttributes({}, model),
      children: model.title === undefined ? [] : textChildren(model.title),
    }
  },
}

/** One line of a table of contents: a heading, and the listed headings under it. */
export interface TocEntry {
  readonly id: string
  readonly text: string
  readonly depth: number
  readonly children: readonly TocEntry[]
}

interface OpenEntry {
  readonly id: string
  readonly text: string
  readonly depth: number
  readonly children: OpenEntry[]
}

function* flatten(entries: readonly OutlineEntry[]): Generator<OutlineEntry> {
  for (const entry of entries) {
    yield entry
    yield* flatten(entry.children)
  }
}

/**
 * The outline's headings at the listed levels, nested by depth: an entry sits
 * under the nearest shallower listed entry before it, so a level that skips
 * one still nests, and an entry whose own parent level is not listed is
 * lifted rather than lost.
 */
export function tableOfContentsEntries(
  outline: readonly OutlineEntry[],
  levels: LevelRange,
): readonly TocEntry[] {
  const roots: OpenEntry[] = []
  let open: OpenEntry[] = []
  for (const heading of flatten(outline)) {
    if (heading.depth < levels.from || heading.depth > levels.to) continue
    const entry: OpenEntry = {
      id: heading.id,
      text: heading.text,
      depth: heading.depth,
      children: [],
    }
    open = open.filter((candidate) => candidate.depth < entry.depth)
    const parent = open.at(-1)
    if (parent === undefined) roots.push(entry)
    else parent.children.push(entry)
    open.push(entry)
  }
  return roots
}

/**
 * A table of contents read from a directive's parts rather than its node:
 * what the editor holds. The same parser, so the two never disagree.
 */
export function tableOfContentsFrom(
  attributes: DirectiveAttributes | null | undefined,
  words: string,
): TableOfContents {
  return tocDirective.parse({
    type: 'leafDirective',
    name: TOC_DIRECTIVE_NAME,
    attributes: { ...attributes },
    children: words === '' ? [] : textChildren(words),
  })
}
