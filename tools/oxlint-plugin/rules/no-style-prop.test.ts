import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/no-style-prop', () => {
  it('accepts a style object of only CSS custom properties', () => {
    const result = runRule('no-style-prop', fixtureFiles('no-style-prop', 'valid'))
    expect(result.diagnostics).toEqual([])
  })

  it('flags a non-custom-property style key', () => {
    const result = runRule('no-style-prop', fixtureFiles('no-style-prop', 'invalid'))
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.line).toBe(2)
    expect(result.diagnostics[0]?.message).toContain('color')
  })
})
