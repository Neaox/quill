import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/no-secret-in-log', () => {
  it('accepts a logger call with no secret-shaped fields', () => {
    const result = runRule('no-secret-in-log', fixtureFiles('no-secret-in-log', 'valid'))
    expect(result.diagnostics).toEqual([])
  })

  it('flags a password passed to a logger call', () => {
    const result = runRule('no-secret-in-log', fixtureFiles('no-secret-in-log', 'invalid'))
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.line).toBe(4)
    expect(result.diagnostics[0]?.message).toContain('password')
  })
})
