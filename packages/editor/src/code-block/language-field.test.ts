import { describe, expect, it } from 'vitest'

import { codeMirrorSource, languageName } from './language-field.ts'

describe('the language field’s helpers', () => {
  it('names a language, a fence nothing knows, and no language at all', () => {
    expect(languageName('ts')).toBe('TypeScript')
    expect(languageName('kotlin')).toBe('kotlin')
    expect(languageName('')).toBeUndefined()
    expect(languageName(null)).toBeUndefined()
  })

  it('copies nothing, and selects nothing, where no code editor has been drawn', () => {
    const source = codeMirrorSource(() => null)
    expect(source.read()).toEqual({ text: '', mode: 'code' })
    expect(() => {
      source.select()
    }).not.toThrow()
  })
})
