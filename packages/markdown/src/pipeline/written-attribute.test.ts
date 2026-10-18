import type { ContainerDirective } from 'mdast-util-directive'
import { describe, expect, it } from 'vitest'

import { parseDocument } from './parse-document.ts'
import { serializeDocument } from './serialize-document.ts'
import { withAttribute } from './written-attribute.ts'

/** Changes one attribute of the document's first directive and writes the document back. */
function changed(markdown: string, name: string, value: string): string {
  const { ast } = parseDocument(markdown)
  const [first] = ast.children
  if (first?.type !== 'containerDirective') throw new Error('Expected a directive.')
  const directive: ContainerDirective = first
  const attributes = Object.fromEntries(
    Object.entries(directive.attributes ?? {}).map(([key, held]) => [key, held ?? '']),
  )
  const next = withAttribute(attributes, directive.data?.sourceForm ?? null, name, value)
  const rewritten: ContainerDirective = {
    ...directive,
    attributes: next.attributes,
    data: { ...directive.data, sourceForm: next.sourceForm ?? undefined },
  }
  return serializeDocument({ frontMatter: {}, ast: { ...ast, children: [rewritten] } })
}

describe('changing one attribute as it was written', () => {
  it.each([
    [':::callout{type=warning}\nBody.\n:::\n', ':::callout{type=caution}\nBody.\n:::\n'],
    [':::callout{type="warning"}\nBody.\n:::\n', ':::callout{type="caution"}\nBody.\n:::\n'],
    [":::callout{type='warning'}\nBody.\n:::\n", ":::callout{type='caution'}\nBody.\n:::\n"],
    [
      ':::callout{  type = warning  #keep .cls}\nBody.\n:::\n',
      ':::callout{  type = caution  #keep .cls}\nBody.\n:::\n',
    ],
    [
      ':::callout[Heads up]{type=warning}\nBody.\n:::\n',
      ':::callout[Heads up]{type=caution}\nBody.\n:::\n',
    ],
  ])('keeps %j as written but for the value', (source, expected) => {
    expect(changed(source, 'type', 'caution')).toBe(expected)
  })

  it('does not mistake another attribute ending in the same name for it', () => {
    expect(changed(':::callout{subtype=x type=note}\nB.\n:::\n', 'type', 'tip')).toBe(
      ':::callout{subtype=x type=tip}\nB.\n:::\n',
    )
  })

  it('writes the canonical form when the attribute was not written', () => {
    expect(changed(':::callout{#id}\nBody.\n:::\n', 'type', 'tip')).toBe(
      ':::callout{#id type="tip"}\nBody.\n:::\n',
    )
  })

  it('writes the canonical form when the new value cannot be written as the old one was', () => {
    expect(changed(':::callout{type=note}\nB.\n:::\n', 'type', 'two words')).toBe(
      ':::callout{type="two words"}\nB.\n:::\n',
    )
    expect(changed(':::callout{type="note"}\nB.\n:::\n', 'type', 'say "hi"')).toBe(
      ':::callout{type="say &#x22;hi&#x22;"}\nB.\n:::\n',
    )
  })

  it('keeps the rest of how the node was written when it drops the attribute block', () => {
    const next = withAttribute(
      {},
      { padded: true, attributes: { written: '{x}', read: '{}' } },
      'type',
      'tip',
    )
    expect(next.sourceForm).toEqual({ padded: true })
    expect(
      withAttribute({}, { attributes: { written: '{x}', read: '{}' } }, 'type', 'tip').sourceForm,
    ).toBeNull()
  })

  it('adds the attribute to a node with no recorded form', () => {
    expect(withAttribute({ a: '1' }, null, 'type', 'tip')).toEqual({
      attributes: { a: '1', type: 'tip' },
      sourceForm: null,
    })
    expect(withAttribute({}, { padded: true }, 'type', 'tip').sourceForm).toEqual({ padded: true })
  })
})
