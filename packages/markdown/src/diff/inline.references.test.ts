import type { Nodes, PhrasingContent } from 'mdast'
import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { mergePhrasing } from './inline.ts'

function phrasing(markdown: string): PhrasingContent[] {
  const [first] = parseMarkdown(markdown).children
  if (first?.type !== 'paragraph') throw new Error('expected a paragraph')
  return first.children
}

/** Every node's type under these nodes, in reading order, as `parent>child` paths. */
function paths(nodes: readonly Nodes[], above = ''): string[] {
  return nodes.flatMap((node) => {
    const path = `${above}${node.type}`
    return 'children' in node ? [path, ...paths(node.children, `${path}>`)] : [path]
  })
}

describe('merging phrasing that holds a link written as a reference', () => {
  it('keeps the reference around the words it holds, inside the change', () => {
    const merged = mergePhrasing(
      phrasing('See [the guide][g].\n\n[g]: /guide\n'),
      phrasing('See [the guide][g] now.\n\n[g]: /guide\n'),
    )

    expect(paths(merged.children)).toContain('linkReference>text')
    expect(merged.wordsAdded).toBe(1)
  })

  it('keeps the references of two different definitions apart', () => {
    const merged = mergePhrasing(
      phrasing('[same][a]\n\n[a]: /a\n'),
      phrasing('[same][b]\n\n[b]: /b\n'),
    )

    expect(paths(merged.children).filter((path) => path.endsWith('linkReference'))).toEqual([
      'diffDeletion>linkReference',
      'diffInsertion>linkReference',
    ])
  })
})
