import { describe, expect, it } from 'vitest'

import { parseMarkdown, stringifyMdast } from './pipeline/processor.ts'
import { rewriteTree } from './tree.ts'

describe('rewriteTree', () => {
  it('keeps a node when the rewrite returns undefined', () => {
    const tree = parseMarkdown('# Heading\n\nText.\n')

    expect(stringifyMdast(rewriteTree(tree, () => undefined))).toBe('# Heading\n\nText.\n')
  })

  it('removes a node when the rewrite returns nothing', () => {
    const tree = parseMarkdown('# Heading\n\nText.\n')
    const result = rewriteTree(tree, (node) => (node.type === 'heading' ? [] : undefined))

    expect(stringifyMdast(result)).toBe('Text.\n')
  })

  it('replaces a node with several, and rewrites children before their parent', () => {
    const tree = parseMarkdown('> quoted **word**\n')
    const seen: string[] = []
    const result = rewriteTree(tree, (node) => {
      seen.push(node.type)
      return node.type === 'strong' ? [{ type: 'text', value: 'plain' }] : undefined
    })

    expect(seen.indexOf('strong')).toBeLessThan(seen.indexOf('paragraph'))
    expect(stringifyMdast(result)).toBe('> quoted plain\n')
  })

  it('tells a rewrite what its node sits inside', () => {
    const tree = parseMarkdown('> quoted **word**\n')
    const parents = new Map<string, string>()
    rewriteTree(tree, (node, parentType) => {
      parents.set(node.type, parentType)
      return undefined
    })

    expect(parents.get('blockquote')).toBe('root')
    expect(parents.get('paragraph')).toBe('blockquote')
    expect(parents.get('strong')).toBe('paragraph')
    expect(parents.get('text')).toBe('strong')
  })

  it('does not mutate the tree it was given', () => {
    const tree = parseMarkdown('Text.\n')
    const before = structuredClone(tree)
    rewriteTree(tree, () => [])

    expect(tree).toEqual(before)
  })
})
