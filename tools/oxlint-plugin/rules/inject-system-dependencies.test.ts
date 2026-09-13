import { describe, expect, it } from 'vitest'
import { fixtureFiles, runRule } from '../test-support/run-oxlint.ts'

describe('quill/inject-system-dependencies', () => {
  it('accepts Date passed in as an argument, randomBytes, and a local function that merely shares a name with randomUUID', () => {
    const result = runRule(
      'inject-system-dependencies',
      fixtureFiles('inject-system-dependencies', 'valid'),
    )
    expect(result.diagnostics).toEqual([])
  })

  it('flags Date.now(), globalThis-prefixed globals, and randomUUID/webcrypto reached through a node:crypto import', () => {
    const result = runRule(
      'inject-system-dependencies',
      fixtureFiles('inject-system-dependencies', 'invalid'),
    )
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message)
    const countOf = (message: string) =>
      messages.filter((candidate) => candidate === message).length

    // bad.ts: Date.now() + global-this.ts: globalThis.Date.now()
    expect(countOf('Inject a Clock instead of calling Date.now() directly.')).toBe(2)
    // global-this.ts: globalThis.crypto.randomUUID()
    expect(countOf('Inject an IdGenerator instead of calling crypto.randomUUID() directly.')).toBe(
      1,
    )
    // global-this.ts: globalThis.Math.random()
    expect(countOf('Inject an IdGenerator instead of calling Math.random() directly.')).toBe(1)
    // global-this.ts: new globalThis.Date()
    expect(countOf('Inject a Clock instead of calling `new Date()` directly.')).toBe(1)
    // named-import.ts: randomUUID() and the aliased uuid()
    expect(countOf('Inject an IdGenerator instead of calling randomUUID() directly.')).toBe(2)
    // webcrypto-import.ts: webcrypto.randomUUID()
    expect(
      countOf('Inject an IdGenerator instead of calling webcrypto.randomUUID() directly.'),
    ).toBe(1)

    expect(result.diagnostics).toHaveLength(8)
  })
})
