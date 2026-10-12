import type { Element, ElementContent, Properties } from 'hast'
import type { Schema } from 'hast-util-sanitize'
import type { ContainerDirective } from 'mdast-util-directive'

import { CALLOUT_TYPES } from '../directives/callout.ts'
import type { State } from '../render/hast-state.ts'
import type { DetailsNode } from './details.ts'
import { DETAILS_NAME, detailsModel } from './details.ts'

/**
 * How a details is drawn (ADR-048): the browser's own `<details>` and
 * `<summary>`, which open without script, are operated by the keyboard, are
 * announced as what they are, and are searched by the browser's find. Never a
 * `div` and a button imitating them.
 *
 * - `<details class="details" open name="…">`: open for a reader by default
 *   when the document says so; `name` makes it one of an exclusive group,
 *   which the browser closes the others of as it opens.
 * - `<summary>`: the summary's inline Markdown, or the kind of thing it is
 *   ("Details", or the callout's kind) when the author wrote none.
 * - `<div class="details-body">`: every block the details holds.
 *
 * A details with a callout kind is that callout, folded: it carries the
 * callout's classes too, so it is coloured as the callout is. An accordion
 * is `<div class="accordion">` around its details, each named for it.
 *
 * Nothing here remembers anything: whether a details is open is the
 * document's default and then the reader's click, never stored.
 */

function element(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

function text(value: string): ElementContent {
  return { type: 'text', value }
}

function capitalise(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

export interface DetailsRenderer {
  details(state: State, node: DetailsNode, parent: unknown): Element
  accordion(state: State, node: ContainerDirective): Element
}

/**
 * The two handlers, sharing the names one render gives its accordions.
 * Created per render, so the names count from one in every document and the
 * output is the same every time (ADR-039).
 */
export function createDetailsRenderer(): DetailsRenderer {
  const names = new WeakMap<object, string>()
  let accordions = 0

  const groupName = (node: DetailsNode, parent: unknown): string | undefined => {
    const group = typeof parent === 'object' && parent !== null ? names.get(parent) : undefined
    return group ?? detailsModel(node).name
  }

  return {
    details(state, node, parent) {
      const model = detailsModel(node)
      const name = groupName(node, parent)
      const summary =
        model.summary === undefined
          ? [text(model.kind === undefined ? 'Details' : capitalise(model.kind))]
          : state.all(model.summary)
      const properties: Properties = {
        className:
          model.kind === undefined ? ['details'] : ['details', 'callout', `callout-${model.kind}`],
        ...(model.open ? { open: true } : {}),
        ...(name === undefined ? {} : { name }),
      }
      return element(
        'details',
        properties,
        state.wrap(
          [
            element('summary', {}, summary),
            element(
              'div',
              { className: ['details-body'] },
              state.wrap(state.all({ ...node, children: model.body }), true),
            ),
          ],
          true,
        ),
      )
    },

    accordion(state, node) {
      accordions += 1
      const own = node.attributes?.['name']
      names.set(
        node,
        typeof own === 'string' && DETAILS_NAME.test(own) ? own : `accordion-${accordions}`,
      )
      return element('div', { className: ['accordion'] }, state.wrap(state.all(node), true))
    },
  }
}

/**
 * What the sanitiser must admit for these elements and nothing more (ADR-011,
 * ADR-039's `SanitizeGrant`): fixed class names, and a name only in its own
 * shape. `details` and `summary` are the default schema's own elements, and
 * `open` its own attribute.
 */
export const DETAILS_SANITIZE_GRANT: {
  readonly classes: Readonly<Record<'details' | 'div', readonly string[]>>
  readonly attributes: { readonly details: NonNullable<Schema['attributes']>[string] }
} = {
  classes: {
    details: ['details', 'callout', ...CALLOUT_TYPES.map((type) => `callout-${type}`)],
    div: ['details-body', 'accordion'],
  },
  attributes: { details: ['open', ['name', DETAILS_NAME]] },
}
