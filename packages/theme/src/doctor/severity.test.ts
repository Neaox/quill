import { describe, expect, it } from 'vitest'
import { bySeverity, SEVERITY_ORDER, severityCounts, verdictOf } from './severity.ts'

const result = (id: string, status: 'pass' | 'adjusted' | 'warn', acknowledged = false) => ({
  id,
  status,
  acknowledged,
})

describe('bySeverity', () => {
  it('puts warnings first, then adjustments, then what was accepted, then passes', () => {
    const results = [
      result('a', 'pass'),
      result('b', 'warn'),
      result('c', 'adjusted'),
      result('d', 'warn', true),
      result('e', 'warn'),
      result('f', 'pass'),
    ]

    expect(
      bySeverity(results).map((group) => [group.severity, group.results.map((entry) => entry.id)]),
    ).toEqual([
      ['warn', ['b', 'e']],
      ['adjusted', ['c']],
      ['accepted', ['d']],
      ['pass', ['a', 'f']],
    ])
  })

  it('leaves out a group nothing falls into', () => {
    expect(bySeverity([result('a', 'pass')]).map((group) => group.severity)).toEqual(['pass'])
    expect(bySeverity([])).toEqual([])
  })

  it('treats an acknowledgement of a rule that holds, or a result that carries none, as nothing', () => {
    expect(bySeverity([result('a', 'pass', true)]).map((group) => group.severity)).toEqual(['pass'])
    expect(bySeverity([{ status: 'warn' as const }]).map((group) => group.severity)).toEqual([
      'warn',
    ])
  })
})

describe('verdictOf and severityCounts', () => {
  it('counts each severity, and lists the counts most severe first without the empty ones', () => {
    const verdict = verdictOf([result('a', 'pass'), result('b', 'warn'), result('c', 'warn', true)])
    expect(verdict).toEqual({ warn: 1, adjusted: 0, accepted: 1, pass: 1 })
    expect(severityCounts(verdict)).toEqual([
      { severity: 'warn', count: 1 },
      { severity: 'accepted', count: 1 },
      { severity: 'pass', count: 1 },
    ])
  })

  it('follows the one severity order', () => {
    expect(SEVERITY_ORDER).toEqual(['warn', 'adjusted', 'accepted', 'pass'])
  })
})
