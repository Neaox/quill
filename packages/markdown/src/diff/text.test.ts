import type { Nodes, Text } from 'mdast'
import { describe, expect, it } from 'vitest'

import { plainText } from './text.ts'

const text = (value: string): Text => ({ type: 'text', value })

describe('plainText', () => {
  it('reads a picture as its alt text, and as nothing when it has none', () => {
    expect(plainText({ type: 'image', url: '/a.png', alt: 'a chart' })).toBe('a chart')
    expect(plainText({ type: 'image', url: '/a.png' })).toBe('')
    expect(plainText({ type: 'imageReference', identifier: 'a', referenceType: 'full' })).toBe('')
  })

  it('joins the words of a line as they are and separates blocks with a space', () => {
    const list: Nodes = {
      type: 'list',
      children: [
        { type: 'listItem', children: [{ type: 'paragraph', children: [text('one')] }] },
        { type: 'listItem', children: [{ type: 'paragraph', children: [text('two')] }] },
      ],
    }

    expect(plainText(list)).toBe('one two')
    expect(
      plainText({
        type: 'paragraph',
        children: [text('a'), { type: 'emphasis', children: [text('b')] }],
      }),
    ).toBe('ab')
  })

  it('reads a changed code block as its lines, with the segments of each line joined', () => {
    expect(
      plainText({
        type: 'diffCode',
        lines: [
          {
            change: 'equal',
            before: 1,
            after: 1,
            segments: [
              { change: 'equal', text: 'const b = ' },
              { change: 'added', text: '3' },
            ],
          },
          { change: 'added', after: 2, segments: [{ change: 'added', text: 'return b' }] },
        ],
      }),
    ).toBe('const b = 3\nreturn b')
  })

  it('reads a node with neither text nor children as nothing', () => {
    expect(plainText({ type: 'thematicBreak' })).toBe('')
  })
})
