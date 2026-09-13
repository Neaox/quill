import { describe, expect, it } from 'vitest'

import { snippetSegments } from './snippet.ts'

function segments(text: string, ranges: readonly { start: number; end: number }[]) {
  return snippetSegments({ text, ranges: [...ranges] }).map(
    (segment) => `${segment.marked ? '[' : ''}${segment.text}${segment.marked ? ']' : ''}`,
  )
}

describe('snippetSegments', () => {
  it('leaves a snippet with no matches as one plain run', () => {
    expect(segments('Regional failover', [])).toEqual(['Regional failover'])
  })

  it('cuts the matched spans out of the surrounding text', () => {
    expect(
      segments('the failover runbook covers failover', [
        { start: 4, end: 12 },
        { start: 28, end: 36 },
      ]),
    ).toEqual(['the ', '[failover]', ' runbook covers ', '[failover]'])
  })

  it('emits no empty run for a match at either edge', () => {
    expect(segments('failover', [{ start: 0, end: 8 }])).toEqual(['[failover]'])
    expect(segments('a failover', [{ start: 2, end: 10 }])).toEqual(['a ', '[failover]'])
  })

  it('sorts ranges the server did not, so the words keep their order', () => {
    expect(
      segments('alpha beta', [
        { start: 6, end: 10 },
        { start: 0, end: 5 },
      ]),
    ).toEqual(['[alpha]', ' ', '[beta]'])
  })

  it('merges overlapping and touching ranges rather than duplicating the text', () => {
    expect(
      segments('failover runbook', [
        { start: 0, end: 8 },
        { start: 4, end: 16 },
      ]),
    ).toEqual(['[failover runbook]'])

    expect(
      segments('failover runbook', [
        { start: 0, end: 8 },
        { start: 8, end: 16 },
      ]),
    ).toEqual(['[failover runbook]'])
  })

  it('clamps a range that runs past the text instead of producing nothing', () => {
    expect(segments('failover', [{ start: 4, end: 99 }])).toEqual(['fail', '[over]'])
    expect(segments('failover', [{ start: -5, end: 4 }])).toEqual(['[fail]', 'over'])
  })

  it('drops a range that is inverted or has no width', () => {
    expect(segments('failover', [{ start: 5, end: 5 }])).toEqual(['failover'])
    expect(segments('failover', [{ start: 6, end: 2 }])).toEqual(['failover'])
    expect(segments('failover', [{ start: 99, end: 120 }])).toEqual(['failover'])
  })

  it('says nothing at all about an empty snippet', () => {
    expect(snippetSegments({ text: '', ranges: [] })).toEqual([])
  })

  it('carries each run’s offset, so a repeated word still has a stable key', () => {
    expect(
      snippetSegments({
        text: 'failover and failover',
        ranges: [
          { start: 0, end: 8 },
          { start: 13, end: 21 },
        ],
      }),
    ).toEqual([
      { text: 'failover', marked: true, start: 0 },
      { text: ' and ', marked: false, start: 8 },
      { text: 'failover', marked: true, start: 13 },
    ])
  })
})
