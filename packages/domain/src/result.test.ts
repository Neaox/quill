import { describe, expect, it } from 'vitest'

import { err, ok } from './result.ts'

describe('ok', () => {
  it('wraps a value as a success', () => {
    const result = ok(42)
    expect(result).toEqual({ ok: true, value: 42 })
  })

  it('narrows to the value when checked', () => {
    const result = ok('done')
    expect(result.ok ? result.value : 'unreachable').toBe('done')
  })
})

describe('err', () => {
  it('wraps a reason as a failure', () => {
    const result = err('too big')
    expect(result).toEqual({ ok: false, error: 'too big' })
  })

  it('narrows to the error when checked', () => {
    const result = err({ kind: 'nope' })
    expect(result.ok ? 'unreachable' : result.error).toEqual({ kind: 'nope' })
  })
})
