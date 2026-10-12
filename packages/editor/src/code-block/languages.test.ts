import { CODE_LANGUAGES, SUPPORTED_LANGUAGES } from '@quill/highlight'
import { describe, expect, it } from 'vitest'

import { LANGUAGES, languageForFile, resolveLanguage } from './languages.ts'

describe('the editor’s languages', () => {
  it('are the registry’s, so the editor colours every language the reader does', () => {
    expect(LANGUAGES).toBe(CODE_LANGUAGES)
    for (const grammar of SUPPORTED_LANGUAGES) {
      expect(resolveLanguage(grammar)?.grammar, `no language tokenized by ${grammar}`).toBe(grammar)
    }
  })

  it('resolve a fence name, an alias, or a file to the entry the picker writes', () => {
    expect(resolveLanguage('typescript')?.id).toBe('typescript')
    expect(resolveLanguage('  TS  ')?.id).toBe('typescript')
    expect(resolveLanguage('sh')?.id).toBe('bash')
    expect(languageForFile('main.go')?.id).toBe('go')
  })

  it('know nothing of plain text or a fence nothing colours', () => {
    expect(resolveLanguage('mermaid')).toBeUndefined()
    expect(resolveLanguage(null)).toBeUndefined()
    expect(resolveLanguage('')).toBeUndefined()
  })
})
