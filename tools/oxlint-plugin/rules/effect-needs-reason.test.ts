import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/effect-needs-reason', () => {
  it('accepts an effect with a comment immediately above it', () => {
    const result = runRule('effect-needs-reason', fixtureFiles('effect-needs-reason', 'valid'))
    expect(result.diagnostics).toEqual([])
  })

  it('flags an effect with no preceding comment', () => {
    const result = runRule('effect-needs-reason', fixtureFiles('effect-needs-reason', 'invalid'))
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.line).toBe(4)
    expect(result.diagnostics[0]?.message).toContain('useEffect')
  })
})
