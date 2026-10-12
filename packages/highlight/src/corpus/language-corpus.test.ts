import { describe, expect, it } from 'vitest'

import { CODE_LANGUAGES } from '../languages.ts'
import { tokenize } from '../tokenize.ts'
import { corpusDocument, LANGUAGE_CORPUS } from './language-corpus.ts'

describe('the language corpus', () => {
  it.each(CODE_LANGUAGES.map((language) => [language.label, language] as const))(
    'colours its %s block',
    (_label, language) => {
      const ranges = tokenize(LANGUAGE_CORPUS[language.id], language.grammar)
      expect(new Set(ranges.map((range) => range.type)).size).toBeGreaterThan(2)
    },
  )

  it('is one document with a fenced block per language, in registry order', () => {
    const fences = [...corpusDocument().matchAll(/^`{3,}(\S+)$/gmu)].map((match) => match[1])
    expect(fences).toEqual(CODE_LANGUAGES.map((language) => language.id))
  })
})
