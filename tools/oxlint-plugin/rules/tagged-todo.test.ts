import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/tagged-todo', () => {
  it('accepts a TODO tagged with a milestone', () => {
    const result = runRule('tagged-todo', fixtureFiles('tagged-todo', 'valid'))
    expect(result.diagnostics).toEqual([])
  })

  it('flags an untagged TODO', () => {
    const result = runRule('tagged-todo', fixtureFiles('tagged-todo', 'invalid'))
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.line).toBe(1)
    expect(result.diagnostics[0]?.message).toContain('TODO')
  })
})
