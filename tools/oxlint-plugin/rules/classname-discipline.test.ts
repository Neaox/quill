import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/classname-discipline', () => {
  it('accepts literal classes and cx() of string literals', () => {
    const result = runRule('classname-discipline', fixtureFiles('classname-discipline', 'valid'))
    expect(result.diagnostics).toEqual([])
  })

  it('flags a ternary selecting classes from state', () => {
    const result = runRule('classname-discipline', fixtureFiles('classname-discipline', 'invalid'))
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.line).toBe(2)
    expect(result.diagnostics[0]?.message).toContain('Tailwind variant')
  })
})
