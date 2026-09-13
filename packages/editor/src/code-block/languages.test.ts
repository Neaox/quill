import { SUPPORTED_LANGUAGES, resolveLanguage as resolveReadingLanguage } from '@quill/highlight'
import { describe, expect, it } from 'vitest'

import { LANGUAGES, loadGrammar, resolveLanguage } from './languages.ts'

describe('the languages a code block can be written in', () => {
  it('names each one once, and gives each a label', () => {
    const ids = LANGUAGES.map((language) => language.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const language of LANGUAGES) expect(language.label.length).toBeGreaterThan(0)
  })

  it('claims each fence name once, id or alias', () => {
    const names = LANGUAGES.flatMap((language) => [language.id, ...language.aliases])
    expect(new Set(names).size).toBe(names.length)
  })

  it('offers every name the reading surface can colour, so the two agree (ADR-030)', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(resolveLanguage(language), `no picker entry resolves ${language}`).toBeDefined()
    }
  })

  it('writes a name the reading surface resolves to a grammar', () => {
    for (const language of LANGUAGES) {
      expect(resolveReadingLanguage(language.id), `${language.id} is not readable`).not.toBeNull()
    }
  })

  it('loads a grammar for the languages CodeMirror can colour, and none for the rest', () => {
    const withGrammar = LANGUAGES.filter((language) => language.load !== undefined)
    expect(withGrammar.length).toBeGreaterThan(0)
    for (const language of withGrammar) {
      expect(loadGrammar(language)?.language.name.length).toBeGreaterThan(0)
    }
    expect(loadGrammar(resolveLanguage('go'))).toBeUndefined()
    expect(loadGrammar(undefined)).toBeUndefined()
  })

  it('resolves a fence name, an alias, and any casing or padding of either', () => {
    expect(resolveLanguage('typescript')?.id).toBe('typescript')
    expect(resolveLanguage('ts')?.id).toBe('typescript')
    expect(resolveLanguage('  TS  ')?.id).toBe('typescript')
    expect(resolveLanguage('yml')?.id).toBe('yaml')
    expect(resolveLanguage('sh')?.id).toBe('bash')
  })

  it('has no entry for a fence it does not know, or for no fence at all', () => {
    expect(resolveLanguage('mermaid')).toBeUndefined()
    expect(resolveLanguage(null)).toBeUndefined()
    expect(resolveLanguage(undefined)).toBeUndefined()
    expect(resolveLanguage('')).toBeUndefined()
  })
})
