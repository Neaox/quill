import { describe, expect, it } from 'vitest'

import type { TokenRange } from '../tokens.ts'
import { placeRanges, type TextSegment } from './place-ranges.ts'

const node = (data: string) => ({ data })

// "let a\nlet b\nlet c": three lines, each its own text node, the line breaks in none.
const lines = [node('let a'), node('let b'), node('let c')]
const segments: TextSegment[] = [
  { node: lines[0] ?? node(''), start: 0 },
  { node: lines[1] ?? node(''), start: 6 },
  { node: lines[2] ?? node(''), start: 12 },
]

describe('placeRanges', () => {
  it('places each range in the text node that holds it, at offsets within that node', () => {
    const ranges: TokenRange[] = [
      { start: 0, end: 3, type: 'keyword' },
      { start: 6, end: 9, type: 'keyword' },
      { start: 16, end: 17, type: 'variable' },
    ]
    expect(placeRanges(segments, ranges)).toEqual([
      { start: 0, end: 3, type: 'keyword', node: lines[0], from: 0, to: 3 },
      { start: 6, end: 9, type: 'keyword', node: lines[1], from: 0, to: 3 },
      { start: 16, end: 17, type: 'variable', node: lines[2], from: 4, to: 5 },
    ])
  })

  it('splits a range that runs across lines into one piece per node', () => {
    const comment: TokenRange = { start: 4, end: 9, type: 'comment' }
    expect(placeRanges(segments, [comment])).toEqual([
      { start: 4, end: 5, type: 'comment', node: lines[0], from: 4, to: 5 },
      { start: 6, end: 9, type: 'comment', node: lines[1], from: 0, to: 3 },
    ])
  })

  it('drops what lies outside the segments, which are the lines on screen', () => {
    const onScreen = segments.slice(1, 2)
    const ranges: TokenRange[] = [
      { start: 0, end: 3, type: 'keyword' },
      { start: 4, end: 8, type: 'comment' },
      { start: 12, end: 15, type: 'keyword' },
    ]
    expect(placeRanges(onScreen, ranges)).toEqual([
      { start: 6, end: 8, type: 'comment', node: lines[1], from: 0, to: 2 },
    ])
  })

  it('places nothing with no segments or no ranges, and skips empty text nodes', () => {
    expect(placeRanges([], [{ start: 0, end: 1, type: 'keyword' }])).toEqual([])
    expect(placeRanges(segments, [])).toEqual([])
    expect(
      placeRanges([{ node: node(''), start: 0 }], [{ start: 0, end: 1, type: 'keyword' }]),
    ).toEqual([])
  })
})
