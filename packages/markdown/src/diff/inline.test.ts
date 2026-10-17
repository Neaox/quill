import * as fc from 'fast-check'
import type { Paragraph, PhrasingContent, RootContent } from 'mdast'
import { toString } from 'mdast-util-to-string'
import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { mergePhrasing } from './inline.ts'

function phrasing(markdown: string): PhrasingContent[] {
  const [first] = parseMarkdown(markdown).children
  if (first?.type !== 'paragraph') throw new Error('expected a paragraph')
  return first.children
}

/** The merged phrasing as compact text: `{+added}` and `{-removed}`, formatting as `*…*`, `**…**`, `[…](url)`. */
function show(nodes: readonly (PhrasingContent | RootContent)[]): string {
  return nodes
    .map((node): string => {
      switch (node.type) {
        case 'text':
          return node.value
        case 'diffInsertion':
          return `{+${show(node.children)}}`
        case 'diffDeletion':
          return `{-${show(node.children)}}`
        case 'emphasis':
          return `*${show(node.children)}*`
        case 'strong':
          return `**${show(node.children)}**`
        case 'link':
          return `[${show(node.children)}](${node.url})`
        case 'inlineCode':
          return `\`${node.value}\``
        default:
          return `<${node.type}>`
      }
    })
    .join('')
}

function merge(before: string, after: string): string {
  return show(mergePhrasing(phrasing(before), phrasing(after)).children)
}

/** The merged phrasing as the newer text reads: removals dropped. */
function withoutRemovals(nodes: readonly PhrasingContent[]): PhrasingContent[] {
  return nodes
    .filter((node) => node.type !== 'diffDeletion')
    .map((node) =>
      'children' in node
        ? ({ ...node, children: withoutRemovals(node.children) } as PhrasingContent)
        : node,
    )
}

describe('mergePhrasing', () => {
  it('marks words, keeping the text around them', () => {
    expect(merge('Deploy on Monday.', 'Deploy on Tuesday.')).toBe('Deploy on {-Monday}{+Tuesday}.')
  })

  it('keeps formatting around and inside a change', () => {
    expect(merge('Read *the old guide* first.', 'Read *the new guide* first.')).toBe(
      'Read *the *{-*old*}{+*new*}* guide* first.',
    )
  })

  it('treats a formatting change as a change of the words it covers', () => {
    expect(merge('Use the API.', 'Use the **API**.')).toBe('Use the {-API}{+**API**}.')
  })

  it('treats a changed link target as a change', () => {
    expect(merge('See [docs](/a).', 'See [docs](/b).')).toBe('See {-[docs](/a)}{+[docs](/b)}.')
  })

  it('compares inline code whole', () => {
    expect(merge('Run `pnpm test` now.', 'Run `pnpm check` now.')).toBe(
      'Run {-`pnpm test`}{+`pnpm check`} now.',
    )
  })

  it('counts words added and removed', () => {
    const merged = mergePhrasing(
      phrasing('Ship it on Monday.'),
      phrasing('Ship it on Tuesday after review.'),
    )
    expect(merged.wordsAdded).toBe(3)
    expect(merged.wordsRemoved).toBe(1)
  })

  it('reads as the newer text, with the removals skipped', () => {
    const words = fc.array(fc.constantFrom('alpha', 'beta', 'gamma', 'delta', '*em*', '`code`'), {
      maxLength: 10,
    })
    fc.assert(
      fc.property(words, words, (left, right) => {
        const before = left.length === 0 ? 'x' : left.join(' ')
        const after = right.length === 0 ? 'x' : right.join(' ')
        const merged = mergePhrasing(phrasing(before), phrasing(after))
        const paragraph: Paragraph = {
          type: 'paragraph',
          children: withoutRemovals(merged.children),
        }
        expect(toString(paragraph)).toBe(toString({ type: 'paragraph', children: phrasing(after) }))
      }),
    )
  })
})
