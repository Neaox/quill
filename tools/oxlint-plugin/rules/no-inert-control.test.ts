import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/no-inert-control', () => {
  it('accepts controls with an action, an escape hatch, or a trusted ancestor', () => {
    const result = runRule('no-inert-control', fixtureFiles('no-inert-control', 'valid'))
    expect(result.diagnostics).toEqual([])
  })

  it('flags a Button, a button, an a, and a Link with no action or destination', () => {
    const result = runRule('no-inert-control', fixtureFiles('no-inert-control', 'invalid'))
    expect(result.diagnostics).toHaveLength(4)
    expect(result.diagnostics.map((d) => d.line)).toEqual([4, 5, 6, 7])
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).toBe(
        'Interactive elements never silently do nothing: give it an action, or disable it with a reason (docs/design/feedback.md)',
      )
    }
  })
})
