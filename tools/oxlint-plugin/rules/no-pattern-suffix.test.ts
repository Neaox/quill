import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/no-pattern-suffix', () => {
  it('accepts a name without a pattern suffix, including camelCase names that would only be banned in PascalCase', () => {
    const result = runRule('no-pattern-suffix', fixtureFiles('no-pattern-suffix', 'valid'))
    expect(result.diagnostics).toEqual([])
  })

  it('flags a class name, and a PascalCase function and variable name, ending in a pattern word', () => {
    const result = runRule('no-pattern-suffix', fixtureFiles('no-pattern-suffix', 'invalid'))
    expect(result.diagnostics).toHaveLength(3)
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message)
    expect(messages.some((message) => message.includes('DocumentManager'))).toBe(true)
    expect(messages.some((message) => message.includes('ParseStrategy'))).toBe(true)
    expect(messages.some((message) => message.includes('RetryManager'))).toBe(true)
  })
})
