import type { Root } from 'mdast'
import type { LeafDirective } from 'mdast-util-directive'
import { visit } from 'unist-util-visit'

import type {
  Directive,
  DirectiveAttributes,
  DirectiveDefinition,
  DirectiveIssue,
} from '../directives/definition.ts'
import { attribute, claims, flag, issue, label, textChildren } from '../directives/definition.ts'
import { stripPresenterNotes } from '../directives/strip-presenter-notes.ts'
import type { ChildPagesQuery } from './slot-key.ts'
import {
  childPagesSlotKey,
  DEFAULT_CHILD_PAGES_QUERY,
  isChildPagesSort,
  parseChildPagesDepth,
} from './slot-key.ts'

export type { ChildPagesDepth, ChildPagesQuery, ChildPagesSort } from './slot-key.ts'
export {
  CHILD_PAGES_BLOCK,
  CHILD_PAGES_DEPTHS,
  CHILD_PAGES_SLOT_KEY,
  CHILD_PAGES_SORTS,
  childPagesSlotKey,
  DEFAULT_CHILD_PAGES_QUERY,
  isChildPagesSort,
  parseChildPagesDepth,
  parseChildPagesSlotKey,
} from './slot-key.ts'

/**
 * `::children`: the pages under this one (ADR-058).
 *
 * `::children[In this section]{depth=2 sort=title excerpts icons}`. The label
 * is an optional title; `depth` how many levels of descendants, 1 to 6;
 * `sort` the navigation's order (`manual`), `title`, or `updated`;
 * `excerpts` and `icons` add each page's summary and icon.
 *
 * The list depends on other documents and on who is reading, so the body
 * never holds it (ADR-031): the renderer draws a slot keyed by the options
 * (`childPagesSlotKey`) and the page fills it as it is assembled (ADR-032).
 */

export const CHILDREN_DIRECTIVE_NAME = 'children'

export interface ChildPagesBlock extends ChildPagesQuery {
  readonly title: string | undefined
}

export const DEFAULT_CHILD_PAGES: ChildPagesBlock = {
  title: undefined,
  ...DEFAULT_CHILD_PAGES_QUERY,
}

function titleOf(node: Directive): string | undefined {
  const written = label(node)?.trim()
  return written === undefined || written === '' ? undefined : written
}

const OWNED = new Set(['depth', 'sort', 'excerpts', 'icons'])

/**
 * The directive's attributes with the options set as the model says: an
 * option at its default is left out, and every attribute this block does not
 * own is kept (AGENTS.md rule 7).
 */
export function childPagesAttributes(
  attributes: DirectiveAttributes | null | undefined,
  model: ChildPagesQuery,
): Record<string, string> {
  const kept = Object.fromEntries(
    Object.entries(attributes ?? {}).flatMap(([name, value]) =>
      OWNED.has(name) ? [] : [[name, value ?? '']],
    ),
  )
  return {
    ...kept,
    ...(model.depth === DEFAULT_CHILD_PAGES.depth ? {} : { depth: String(model.depth) }),
    ...(model.sort === DEFAULT_CHILD_PAGES.sort ? {} : { sort: model.sort }),
    ...(model.excerpts ? { excerpts: '' } : {}),
    ...(model.icons ? { icons: '' } : {}),
  }
}

export const childrenDirective: DirectiveDefinition<ChildPagesBlock, LeafDirective> = {
  names: [CHILDREN_DIRECTIVE_NAME],
  kinds: ['leaf'],

  parse(node: LeafDirective): ChildPagesBlock {
    const depth = attribute(node, 'depth')
    const sort = attribute(node, 'sort')
    return {
      title: titleOf(node),
      depth:
        (depth === undefined ? undefined : parseChildPagesDepth(depth)) ??
        DEFAULT_CHILD_PAGES.depth,
      sort: isChildPagesSort(sort) ? sort : DEFAULT_CHILD_PAGES.sort,
      excerpts: flag(node, 'excerpts'),
      icons: flag(node, 'icons'),
    }
  },

  validate(node: Directive): readonly DirectiveIssue[] {
    const depth = attribute(node, 'depth')
    const sort = attribute(node, 'sort')
    return [
      ...(depth === undefined || parseChildPagesDepth(depth) !== undefined
        ? []
        : [
            issue(
              'depth',
              `Depth "${depth}" is not a whole number from 1 to 6; one level is listed.`,
              'warning',
            ),
          ]),
      ...(sort === undefined || isChildPagesSort(sort)
        ? []
        : [
            issue(
              'sort',
              `Unknown sort "${sort}"; pages are listed in the navigation’s order.`,
              'warning',
            ),
          ]),
    ]
  },

  serialize(model: ChildPagesBlock): LeafDirective {
    return {
      type: 'leafDirective',
      name: CHILDREN_DIRECTIVE_NAME,
      attributes: childPagesAttributes({}, model),
      children: model.title === undefined ? [] : textChildren(model.title),
    }
  },
}

/**
 * The slot keys a document's body carries, once each, in document order: what
 * the rendered content lists in `slots`, so a page knows what to fill without
 * reading the HTML (ADR-032). Presenter notes are not part of the body.
 */
export function childPagesSlots(tree: Root): readonly string[] {
  const keys = new Set<string>()
  visit(stripPresenterNotes(tree), 'leafDirective', (node: LeafDirective) => {
    if (claims(childrenDirective, node)) keys.add(childPagesSlotKey(childrenDirective.parse(node)))
  })
  return [...keys]
}

/**
 * A child pages block read from a directive's parts rather than its node:
 * what the editor holds. The same parser, so the two never disagree.
 */
export function childPagesFrom(
  attributes: DirectiveAttributes | null | undefined,
  words: string,
): ChildPagesBlock {
  return childrenDirective.parse({
    type: 'leafDirective',
    name: CHILDREN_DIRECTIVE_NAME,
    attributes: { ...attributes },
    children: words === '' ? [] : textChildren(words),
  })
}
