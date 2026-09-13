import { Node as PMNode, Schema } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'
import type { PhrasingContent, Root, RootContent } from 'mdast'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { mdastToProseMirror } from './from-mdast.ts'
import { liftLayout, wrapLayout } from './layout.ts'
import { schema } from './schema.ts'
import { proseMirrorToMdast } from './to-mdast.ts'

/** markdown -> mdast -> ProseMirror -> mdast -> markdown. */
function roundTrip(markdown: string, options?: Parameters<typeof mdastToProseMirror>[1]): string {
  const { doc } = mdastToProseMirror(parseMarkdown(markdown), options)
  return stringifyMdast(proseMirrorToMdast(doc).tree)
}

function toDoc(markdown: string): PMNode {
  return mdastToProseMirror(parseMarkdown(markdown)).doc
}

describe('the editor schema', () => {
  it('builds headlessly, with no DOM anywhere', () => {
    expect('document' in globalThis).toBe(false)
    expect(Object.keys(schema.nodes)).toHaveLength(28)
    expect(Object.keys(schema.marks)).toHaveLength(5)
  })

  it('lets the code mark coexist with every other mark', () => {
    // A TipTap upgrade that reintroduces `excludes: "_"` must fail here, loudly:
    // Markdown writes a link around inline code and strong around inline code.
    const code = schema.marks['code']
    const excluded = Object.values(schema.marks).filter((mark) => code?.excludes(mark) === true)

    expect(excluded).toEqual([])
  })

  it('accepts a link around inline code and strong around inline code', () => {
    expect(roundTrip('[`parse()`](./api.md) and **`bold code`**.\n')).toBe(
      '[`parse()`](./api.md) and **`bold code`**.\n',
    )
  })

  it('produces documents that pass Node.check()', () => {
    expect(() => toDoc('# Heading\n\n| a |\n| - |\n| 1 |\n').check()).not.toThrow()
  })
})

describe('mdast to ProseMirror and back', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['headings and prose', '# One\n\nProse with *emphasis* and **strong**.\n'],
    ['strikethrough', 'A ~~removed~~ word.\n'],
    ['nested emphasis', '*italic with **bold** inside*\n'],
    ['blockquote', '> Quoted.\n'],
    ['thematic break', '---\n'],
    ['hard break', 'One\\\ntwo\n'],
    ['bullet list', '- alpha\n- beta\n'],
    ['ordered list', '3. three\n4. four\n'],
    ['task list', '- [ ] todo\n- [x] done\n'],
    ['mixed checkbox list', '- [x] done\n- plain\n'],
    ['nested list starting with a list', '- - deep\n'],
    ['loose list', '- one\n\n- two\n'],
    ['code with language and meta', '```ts title="server.ts"\nconst a = 1\n```\n'],
    ['table with alignment', '| a | b |\n| :- | -: |\n| 1 | 2 |\n'],
    ['inline and block HTML', '<div>\nblock\n</div>\n\nInline <kbd>x</kbd> here.\n'],
    ['image with a title', '![alt](img.png "Caption")\n'],
    ['reference link', 'A [reference][ref] link.\n\n[ref]: https://example.com "Title"\n'],
    ['reference image', '![Badge][badge]\n\n[badge]: badge.svg\n'],
    ['collapsed reference', 'A [ref][] link.\n\n[ref]: https://example.com\n'],
    ['footnotes', 'Text[^1]\n\n[^1]: The note.\n'],
    ['container directive', ':::callout{type="warning"}\nCareful.\n:::\n'],
    ['directive label', ':::callout[Heads up]{type="note"}\nBody.\n:::\n'],
    ['leaf directive', '::toc{depth="3"}\n'],
    ['text directive', 'Status: :badge[stable]{colour="green"}.\n'],
    ['unknown directive', ':::timeline{orientation="vertical"}\nAn entry.\n:::\n'],
    ['front matter', '---\ntitle: One\nunknown: kept\n---\n\nBody.\n'],
    ['layout wrapper', ':::wide\n| a |\n| - |\n| 1 |\n:::\n'],
  ]

  for (const [name, markdown] of cases) {
    it(`round trips ${name}`, () => {
      expect(roundTrip(markdown)).toBe(markdown)
    })
  }

  it('round trips blocks with nothing in them', () => {
    expect(roundTrip('```\n```\n')).toBe('```\n```\n')
    expect(roundTrip('-\n')).toBe('-\n')
  })

  it('gives an empty document an empty paragraph to stand in', () => {
    const { doc } = mdastToProseMirror({ type: 'root', children: [] })

    expect(doc.childCount).toBe(1)
    expect(doc.child(0).type.name).toBe('paragraph')
  })

  it('preserves a source-wrapped paragraph by default', () => {
    expect(roundTrip('One line\nwrapped here.\n')).toBe('One line\nwrapped here.\n')
  })

  it('collapses soft wraps when asked, as the first publish from the editor does', () => {
    expect(roundTrip('One line\nwrapped here.\n', { softBreaks: 'collapse' })).toBe(
      'One line wrapped here.\n',
    )
  })

  it('carries an mdast node it does not model through unchanged', () => {
    const invented = {
      type: 'somethingNeverSeen',
      payload: { nested: [1, 2, 3] },
      position: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    } as unknown as RootContent
    const tree: Root = { type: 'root', children: [invented] }
    const { doc, warnings } = mdastToProseMirror(tree)
    const { payload: _payload, ...rest } = invented as unknown as Record<string, unknown>

    expect(warnings).toEqual([{ code: 'unsupported-block', detail: 'somethingNeverSeen' }])
    expect(proseMirrorToMdast(doc).tree.children[0]).toEqual({
      type: 'somethingNeverSeen',
      payload: { nested: [1, 2, 3] },
    })
    expect(rest['position']).toBeDefined()
  })

  it('carries a raw Markdown escape hatch node through as text', () => {
    const tree: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'rawMdast', value: 'kept' }] }],
    }

    expect(stringifyMdast(proseMirrorToMdast(mdastToProseMirror(tree).doc).tree)).toBe('kept\n')
  })

  it('carries a block-level escape hatch node across without calling it unsupported', () => {
    // It is on the escape hatch because an earlier parse put it there on
    // purpose; reporting it again would tell an author their document is
    // unsupported every time they open it.
    const tree: Root = { type: 'root', children: [{ type: 'rawMdast', value: '<!-- kept -->' }] }
    const { doc, warnings } = mdastToProseMirror(tree)

    expect(warnings).toEqual([])
    expect(stringifyMdast(proseMirrorToMdast(doc).tree)).toBe('<!-- kept -->\n')
  })

  it('warns about an inline node it does not model, keeping its text', () => {
    const invented = { type: 'neverSeenInline', value: 'kept' } as unknown as PhrasingContent
    const tree: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [invented] }],
    }
    const { doc, warnings } = mdastToProseMirror(tree)

    expect(warnings).toEqual([{ code: 'unsupported-inline', detail: 'neverSeenInline' }])
    expect(stringifyMdast(proseMirrorToMdast(doc).tree)).toBe('kept\n')
  })

  it('flattens a table cell of several blocks, and says so', () => {
    const doc = schema.node('doc', null, [
      schema.node('table', { align: null }, [
        schema.node('tableRow', null, [
          schema.node('tableHeader', null, [
            schema.node('paragraph', null, [schema.text('one')]),
            schema.node('paragraph', null, [schema.text('two')]),
          ]),
        ]),
      ]),
    ])
    const { tree, warnings } = proseMirrorToMdast(doc)

    expect(warnings).toEqual([{ code: 'table-cell-flattened', detail: '2 blocks' }])
    expect(stringifyMdast(tree)).toBe('| onetwo |\n| - |\n')
  })

  it('writes an inline code mark that wraps something with no text of its own', () => {
    const code = schema.mark('code')
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('a', [code]),
        schema.node('hardBreak').mark([code]),
        schema.text('b', [code]),
      ]),
    ])

    expect(stringifyMdast(proseMirrorToMdast(doc).tree)).toBe('`ab`\n')
  })

  it('never throws on a document built from another schema', () => {
    const other = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'inline*' },
        mystery: { group: 'block' },
        surprise: { group: 'inline', inline: true },
        text: { group: 'inline' },
      },
    })
    const doc = other.node('doc', null, [
      other.node('mystery'),
      other.node('paragraph', null, [other.text('a'), other.node('surprise')]),
    ])
    const { tree, warnings } = proseMirrorToMdast(doc)

    expect(warnings.map((found) => found.code)).toEqual([
      'unknown-block-node',
      'unknown-inline-node',
    ])
    expect(stringifyMdast(tree)).toBe('\n\na\n')
  })
})

describe('layout widths', () => {
  it('lifts a wrapper onto its blocks and lowers it again', () => {
    const doc = toDoc(':::wide\n# Heading\n\nProse.\n:::\n')
    const lifted = liftLayout(doc)

    expect(lifted.child(0).type.name).toBe('heading')
    expect(lifted.child(0).attrs['layout']).toBe('wide')
    expect(stringifyMdast(proseMirrorToMdast(wrapLayout(lifted)).tree)).toBe(
      ':::wide\n# Heading\n\nProse.\n:::\n',
    )
  })

  it('merges adjacent wrappers of the same width and keeps different ones apart', () => {
    const doc = toDoc(':::wide\nOne.\n:::\n\n:::wide\nTwo.\n:::\n\n:::full\nThree.\n:::\n')
    const output = stringifyMdast(proseMirrorToMdast(wrapLayout(liftLayout(doc))).tree)

    expect(output).toBe(':::wide\nOne.\n\nTwo.\n:::\n\n:::full\nThree.\n:::\n')
  })

  it('leaves a wrapper in place when its blocks cannot carry a width', () => {
    const doc = toDoc(':::wide\n[ref]: https://example.com\n:::\n')
    const lifted = liftLayout(doc)

    expect(lifted.child(0).type.name).toBe('containerDirective')
  })

  it('leaves a directive that is not a layout wrapper alone', () => {
    const lifted = liftLayout(toDoc(':::callout{type="note"}\nBody.\n:::\n'))

    expect(lifted.child(0).type.name).toBe('containerDirective')
  })

  it('leaves a wrapper that carries attributes alone', () => {
    const lifted = liftLayout(toDoc(':::wide{id="x"}\nBody.\n:::\n'))

    expect(lifted.child(0).type.name).toBe('containerDirective')
  })

  it('lifts wrappers nested inside other blocks', () => {
    const lifted = liftLayout(toDoc('> :::wide\n> Inner.\n> :::\n'))

    expect(lifted.child(0).child(0).type.name).toBe('paragraph')
    expect(lifted.child(0).child(0).attrs['layout']).toBe('wide')
  })

  it('lifts a wrapper whose attributes are absent altogether', () => {
    const lifted = liftLayout(
      PMNode.fromJSON(schema, {
        type: 'doc',
        content: [
          {
            type: 'containerDirective',
            attrs: { name: 'wide', attributes: null, layout: null },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] }],
          },
        ],
      }),
    )

    expect(lifted.child(0).type.name).toBe('paragraph')
  })
})
