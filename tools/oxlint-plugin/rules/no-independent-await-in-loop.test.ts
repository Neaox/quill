import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/no-independent-await-in-loop', () => {
  it('accepts loops with a data or control dependency between iterations', () => {
    const result = runRule(
      'no-independent-await-in-loop',
      fixtureFiles('no-independent-await-in-loop', 'valid'),
    )
    expect(result.diagnostics).toEqual([])
  })

  it('flags an accumulating push and an index loop whose awaits are independent', () => {
    const result = runRule(
      'no-independent-await-in-loop',
      fixtureFiles('no-independent-await-in-loop', 'invalid'),
    )
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([5, 12])
    expect(result.diagnostics[0]?.message).toContain('Promise.all')
  })
})
