import { describe, expect, it } from 'vitest'

import { Prism, SUPPORTED_LANGUAGES, resolveLanguage } from './grammars.ts'

describe('SUPPORTED_LANGUAGES', () => {
  it('registers a Prism grammar for every supported language', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(Prism.languages[language], `missing grammar for "${language}"`).toBeDefined()
    }
  })
})

describe('resolveLanguage', () => {
  it.each([
    ['html', 'markup'],
    ['htm', 'markup'],
    ['xhtml', 'markup'],
    ['xml', 'markup'],
    ['svg', 'markup'],
    ['markup', 'markup'],
    ['css', 'css'],
    ['js', 'javascript'],
    ['javascript', 'javascript'],
    ['mjs', 'javascript'],
    ['cjs', 'javascript'],
    ['ts', 'typescript'],
    ['typescript', 'typescript'],
    ['jsx', 'jsx'],
    ['tsx', 'tsx'],
    ['json', 'json'],
    ['json5', 'json'],
    ['jsonc', 'json'],
    ['yaml', 'yaml'],
    ['yml', 'yaml'],
    ['bash', 'bash'],
    ['sh', 'bash'],
    ['shell', 'bash'],
    ['shellscript', 'bash'],
    ['zsh', 'bash'],
    ['python', 'python'],
    ['py', 'python'],
    ['go', 'go'],
    ['golang', 'go'],
    ['rust', 'rust'],
    ['rs', 'rust'],
    ['java', 'java'],
    ['csharp', 'csharp'],
    ['c#', 'csharp'],
    ['cs', 'csharp'],
    ['sql', 'sql'],
    ['markdown', 'markdown'],
    ['md', 'markdown'],
    ['diff', 'diff'],
    ['patch', 'diff'],
    ['docker', 'docker'],
    ['dockerfile', 'docker'],
    ['toml', 'toml'],
  ] as const)('maps "%s" to "%s"', (alias, expected) => {
    expect(resolveLanguage(alias)).toBe(expected)
  })

  it('is case- and whitespace-insensitive', () => {
    expect(resolveLanguage(' TS ')).toBe('typescript')
    expect(resolveLanguage('YAML')).toBe('yaml')
  })

  it('returns null for an unknown alias', () => {
    expect(resolveLanguage('cobol')).toBeNull()
    expect(resolveLanguage('')).toBeNull()
  })
})
