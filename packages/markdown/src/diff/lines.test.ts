import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { compareLines, linesOf } from './lines.ts'

describe('compareLines', () => {
  it('numbers lines on both sides and marks the words of a changed line', () => {
    const { lines, wordsAdded, wordsRemoved } = compareLines(
      ['# Title', 'Port 3000.', 'End.'],
      ['# Title', 'Port 3001.', 'New line.', 'End.'],
    )
    expect(lines).toEqual([
      { change: 'equal', before: 1, after: 1, segments: [{ change: 'equal', text: '# Title' }] },
      {
        change: 'removed',
        before: 2,
        segments: [
          { change: 'equal', text: 'Port ' },
          { change: 'removed', text: '3000' },
          { change: 'equal', text: '.' },
        ],
      },
      {
        change: 'added',
        after: 2,
        segments: [
          { change: 'equal', text: 'Port ' },
          { change: 'added', text: '3001' },
          { change: 'equal', text: '.' },
        ],
      },
      { change: 'added', after: 3, segments: [{ change: 'added', text: 'New line.' }] },
      { change: 'equal', before: 3, after: 4, segments: [{ change: 'equal', text: 'End.' }] },
    ])
    expect(wordsAdded).toBe(3)
    expect(wordsRemoved).toBe(1)
  })

  it('rebuilds both texts from the lines it reports', () => {
    const text = fc.array(fc.constantFrom('alpha', 'beta gamma', '', '- item', '```'), {
      maxLength: 15,
    })
    fc.assert(
      fc.property(text, text, (before, after) => {
        const { lines } = compareLines(before, after)
        const side = (skip: string) =>
          lines
            .filter((line) => line.change !== skip)
            .map((line) =>
              line.segments
                .filter((part) => part.change !== skip)
                .map((part) => part.text)
                .join(''),
            )
        expect(side('added')).toEqual(before)
        expect(side('removed')).toEqual(after)
      }),
    )
  })
})

describe('linesOf', () => {
  it('ignores the trailing newline every file ends with', () => {
    expect(linesOf('a\nb\n')).toEqual(['a', 'b'])
    expect(linesOf('')).toEqual([])
  })
})
