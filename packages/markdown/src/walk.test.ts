import { describe, expect, it } from 'vitest'
import { visit } from 'unist-util-visit'
import type { Nodes, Root } from 'mdast'

import { parseMarkdown } from './pipeline/processor.ts'
import { walk } from './walk.ts'

const SOURCE = [
  '# Title',
  '',
  'Some *emphasis*, a [link](./a.md) and `code`.',
  '',
  '- one',
  '  - two [ref][r]',
  '',
  '| a | b |',
  '| --- | --- |',
  '| ![image](x.png) | c |',
  '',
  ':::note',
  'Inside a directive.',
  ':::',
  '',
  '[r]: https://example.com',
].join('\n')

describe('walk', () => {
  it('visits every node in the order unist-util-visit does', () => {
    const tree = parseMarkdown(SOURCE)
    const expected: string[] = []
    visit(tree, (node) => {
      expected.push(node.type)
    })
    const actual: string[] = []
    walk<Nodes>(tree, (node) => {
      actual.push(node.type)
    })
    expect(actual).toEqual(expected)
    expect(actual.length).toBeGreaterThan(20)
  })

  it('skips the children of a node its visitor returns true for', () => {
    const tree = parseMarkdown(SOURCE)
    const seen: string[] = []
    walk<Nodes>(tree, (node) => {
      seen.push(node.type)
      return node.type === 'list' || node.type === 'table'
    })
    expect(seen).toContain('list')
    expect(seen).not.toContain('listItem')
    expect(seen).not.toContain('tableRow')
    expect(seen).toContain('containerDirective')
  })

  it('walks the children a visitor gave the node, not the ones it had', () => {
    const tree: Root = { type: 'root', children: [{ type: 'paragraph', children: [] }] }
    const seen: string[] = []
    walk<Nodes>(tree, (node) => {
      seen.push(node.type)
      if (node.type === 'paragraph') node.children = [{ type: 'text', value: 'placed' }]
    })
    expect(seen).toEqual(['root', 'paragraph', 'text'])
  })
})
