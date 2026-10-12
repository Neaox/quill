import type { Node } from 'mdast'
import { describe, expect, it } from 'vitest'

import { nodeKey, shapeKey } from './keys.ts'

const link = (url: string, value: string) =>
  ({ type: 'link', url, children: [{ type: 'text', value }] }) as Node

const at = (line: number) =>
  ({ type: 'paragraph', children: [], position: { start: { line } } }) as unknown as Node

describe('shapeKey', () => {
  it('is the same for a block written in another field order, with a null where another has none', () => {
    const built = { type: 'list', ordered: false, start: null, children: [] }
    const read = { children: [], ordered: false, type: 'list' }

    expect(shapeKey(built as Node)).toBe(shapeKey(read as Node))
    expect(nodeKey(built as Node)).not.toBe(nodeKey(read as Node))
  })

  it('is the same wherever a link or a picture points, and different for different words', () => {
    expect(shapeKey(link('/a', 'guide'))).toBe(shapeKey(link('/b', 'guide')))
    expect(shapeKey(link('/a', 'guide'))).not.toBe(shapeKey(link('/a', 'manual')))
  })

  it('leaves out where a node came from', () => {
    expect(shapeKey(at(1))).toBe(shapeKey(at(9)))
  })
})
