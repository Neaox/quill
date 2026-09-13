import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/no-set-state-in-effect', () => {
  it('accepts a setter called from a subscription callback', () => {
    const result = runRule(
      'no-set-state-in-effect',
      fixtureFiles('no-set-state-in-effect', 'valid'),
    )
    expect(result.diagnostics).toEqual([])
  })

  it('flags a setter called synchronously in the effect body', () => {
    const result = runRule(
      'no-set-state-in-effect',
      fixtureFiles('no-set-state-in-effect', 'invalid'),
    )
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.line).toBe(7)
    expect(result.diagnostics[0]?.message).toContain('setCount')
  })
})
