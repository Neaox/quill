import type { ElementContent } from 'hast'
import type { LeafDirective, TextDirective } from 'mdast-util-directive'

import type { DirectiveAttributes } from '../directives/definition.ts'
import type { State } from './hast-state.ts'

function text(value: string): ElementContent {
  return { type: 'text', value }
}

/**
 * A directive's attributes, written back the way they were read.
 *
 * `mdast-util-directive` parses `#id` into `id` and `.a.b` into `class`, so they
 * are written back in that shorthand; a valueless attribute keeps its bare name.
 * The result is a text node, so the HTML serialiser escapes it: nothing here can
 * produce markup.
 */
export function attributeSource(attributes: DirectiveAttributes | null | undefined): string {
  const written = Object.entries(attributes ?? {}).map(([name, value]) => {
    if (value === null || value === undefined || value === '') return name
    if (name === 'id') return `#${value}`
    if (name === 'class') {
      return value
        .split(/\s+/)
        .filter((each) => each.length > 0)
        .map((each) => `.${each}`)
        .join('')
    }
    return `${name}="${value}"`
  })
  return written.length === 0 ? '' : `{${written.join(' ')}}`
}

/**
 * A directive this renderer has no handler for, written back as the source the
 * author typed: `:name`, `::name`, its `[label]`, and its attributes.
 *
 * ADR-002's degradation rule is that an unknown directive reads as it would in a
 * renderer that never heard of directives at all — and such a renderer shows the
 * literal text, because it never saw a directive in the first place. Emitting
 * only the children instead silently deleted prose: `:` is a directive marker to
 * the parser, so `Ratio 3:2` is a text directive named `2`, and dropping the
 * marker turned it into `Ratio 3`. The label's children go through `state.all`
 * so `:unknown[**bold**]` keeps its formatting.
 */
export function directiveSource(
  state: State,
  node: LeafDirective | TextDirective,
  marker: string,
): ElementContent[] {
  const label: ElementContent[] =
    node.children.length === 0 ? [] : [text('['), ...state.all(node), text(']')]
  const attributes = attributeSource(node.attributes)
  return [text(`${marker}${node.name}`), ...label, ...(attributes === '' ? [] : [text(attributes)])]
}
