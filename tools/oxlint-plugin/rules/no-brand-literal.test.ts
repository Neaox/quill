import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/no-brand-literal', () => {
  it('does not flag BRAND usage or @quill/* import specifiers', () => {
    const result = runRule('no-brand-literal', fixtureFiles('no-brand-literal', 'valid'))
    expect(result.diagnostics).toEqual([])
  })

  it('flags the code name written as a string literal', () => {
    const result = runRule('no-brand-literal', fixtureFiles('no-brand-literal', 'invalid'))
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.line).toBe(1)
    expect(result.diagnostics[0]?.message).toContain('BRAND')
  })
})
