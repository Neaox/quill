import { describe, expect, it } from 'vitest'
import { adjusted, check, DEFAULT_DOCTOR_OPTIONS, fromChecks, pass, round, warn } from './rule.ts'

describe('outcomes', () => {
  it('carries a status and a reason', () => {
    expect(pass('all good')).toEqual({ status: 'pass', detail: 'all good' })
    expect(adjusted('moved')).toEqual({ status: 'adjusted', detail: 'moved' })
    expect(warn('trouble')).toEqual({ status: 'warn', detail: 'trouble' })
  })
})

describe('fromChecks', () => {
  it('passes with the summary when every measurement holds', () => {
    expect(fromChecks([check('never seen', true)], 'all held')).toEqual({
      status: 'pass',
      detail: 'all held',
    })
  })

  it('warns with the failures only', () => {
    expect(
      fromChecks([check('a failed', false), check('b held', true), check('c failed', false)], 'x'),
    ).toEqual({ status: 'warn', detail: 'a failed; c failed' })
  })
})

describe('round', () => {
  it('defaults to two places and takes any other', () => {
    expect(round(1.23456)).toBe('1.23')
    expect(round(1.23456, 4)).toBe('1.2346')
    expect(round(1.23456, 0)).toBe('1')
  })
})

describe('default options', () => {
  it('enforces AA text contrast, as ADR-028 says', () => {
    expect(DEFAULT_DOCTOR_OPTIONS.textContrast).toBe('enforced')
  })
})
