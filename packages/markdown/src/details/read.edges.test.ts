import type { Paragraph, PhrasingContent, Root, RootContent } from 'mdast'
import { describe, expect, it } from 'vitest'

import { readDetails } from './read.ts'

const text = (value: string): PhrasingContent => ({ type: 'text', value })

const readAsText = (summary: string): PhrasingContent[] => [text(summary)]

const html = (value: string): RootContent => ({ type: 'html', value })

const paragraph = (...children: PhrasingContent[]): Paragraph => ({
  type: 'paragraph',
  children,
})

const read = (...children: RootContent[]): Root =>
  readDetails({ type: 'root', children }, readAsText)

const types = (tree: Root): string[] => tree.children.map((node) => node.type)

describe('reading details out of a tree built in memory', () => {
  it('reads tags that carry no positions', () => {
    expect(types(read(html('<details>'), paragraph(text('Body.')), html('</details>')))).toEqual([
      'details',
    ])
  })

  it('leaves an HTML node of only whitespace where it stands, beside a details', () => {
    expect(
      types(read(html('  '), html('<details>'), paragraph(text('Body.')), html('</details>'))),
    ).toEqual(['html', 'details'])
  })

  it('reads nothing at a level where a details would hold something that is not a block', () => {
    const front: RootContent = { type: 'yaml', value: 'title: A' }

    expect(types(read(html('<details>'), front, html('</details>')))).toEqual([
      'html',
      'yaml',
      'html',
    ])
  })
})

describe('reading a foldable callout out of a tree built in memory', () => {
  const callout = (...inline: PhrasingContent[]): RootContent => ({
    type: 'blockquote',
    children: [paragraph(...inline)],
  })

  it('reads the title that follows a marker which is a text node of its own', () => {
    const [node] = read(
      callout(text('[!note]- '), { type: 'strong', children: [text('Bold')] }, text(' title')),
    ).children

    expect(node).toMatchObject({ type: 'details', syntax: 'callout' })
    expect(node?.type === 'details' && node.children[0]?.type).toBe('paragraph')
  })

  it('keeps the position and the data of the quote it read', () => {
    const position = { start: { line: 3, column: 1 }, end: { line: 4, column: 1 } }
    const [node] = read({
      type: 'blockquote',
      position,
      data: { sourceForm: { blankLines: 0 } },
      children: [paragraph(text('[!note]+ Title'))],
    }).children

    expect(node).toMatchObject({
      type: 'details',
      position,
      data: { sourceForm: { blankLines: 0 } },
    })
  })
})
