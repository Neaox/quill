import { describe, expect, it } from 'vitest'

import { createHasher } from '../infrastructure/hasher.ts'
import { createReaderScript } from './reader-script.ts'

describe('the reader script asset', () => {
  it('is the generated module, addressed by its own hash so it can be cached for ever', () => {
    const script = createReaderScript(createHasher())
    expect(script.href).toBe(`/s/_assets/reader-${script.hash}.js`)
    expect(script.hash).toMatch(/^[0-9a-f]{32}$/u)
    expect(script.source.split('\n')[0]).toContain('generate:reader')
    expect(script.source.trimEnd().endsWith('(window);')).toBe(true)
  })

  it('changes its address when its source changes', () => {
    const hasher = createHasher()
    expect(createReaderScript(hasher, 'a').hash).not.toBe(createReaderScript(hasher, 'b').hash)
  })
})
