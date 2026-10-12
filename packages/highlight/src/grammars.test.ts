import { describe, expect, it } from 'vitest'

import { Prism, SUPPORTED_LANGUAGES } from './grammars.ts'

describe('SUPPORTED_LANGUAGES', () => {
  it('registers a Prism grammar for every supported language', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(Prism.languages[language], `missing grammar for "${language}"`).toBeDefined()
    }
  })
})
