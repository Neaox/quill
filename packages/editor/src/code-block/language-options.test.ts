import { CODE_LANGUAGES, LANGUAGE_CATEGORIES } from '@quill/highlight/languages'
import { describe, expect, it } from 'vitest'

import {
  changesLanguage,
  fenceNameOf,
  languageName,
  languageOptions,
  PLAIN_TEXT,
} from './language-options.ts'

const labelsOf = (query: string, recent: readonly string[] = []) =>
  languageOptions(query, recent).map((group) => [
    group.label,
    group.options.map((option) => option.label),
  ])

/** Every label offered for `query`, in the order offered. */
const ranked = (query: string): string[] =>
  languageOptions(query, []).flatMap((group) => group.options.map((option) => option.label))

const firstOf = (query: string): string | undefined => languageOptions(query, [])[0]?.options[0]?.id

describe('languageOptions', () => {
  it('offers plain text, then every language grouped by category, with nothing typed', () => {
    const groups = languageOptions('', [])
    expect(groups[0]).toEqual({
      id: 'plain',
      label: 'No language',
      options: [{ id: 'plain', label: PLAIN_TEXT.label }],
    })
    const categories = groups.slice(1).map((group) => group.label)
    expect(categories).toEqual(
      LANGUAGE_CATEGORIES.filter((category) => categories.includes(category)),
    )
    const offered = groups.slice(1).flatMap((group) => group.options.map((option) => option.id))
    expect(offered.toSorted()).toEqual(
      CODE_LANGUAGES.map((language) => `language:${language.id}`).toSorted(),
    )
  })

  it('puts the languages used recently ahead of the rest', () => {
    expect(labelsOf('', ['go', 'kotlin', 'bash'])[1]).toEqual(['Recent', ['Go', 'Bash']])
  })

  it('finds a language by its name, a fence name or an extension, best match first', () => {
    expect(firstOf('Python')).toBe('language:python')
    expect(firstOf('ts')).toBe('language:typescript')
    expect(firstOf('rs')).toBe('language:rust')
    expect(firstOf('.go')).toBe('language:go')
    expect(firstOf('main.go')).toBe('language:go')
    expect(firstOf('Dockerfile')).toBe('language:docker')
    expect(firstOf('c#')).toBe('language:csharp')
    expect(firstOf('curl')).toBe('language:bash')
    expect(labelsOf('script')).toEqual([
      ['Web', ['JavaScript', 'JavaScript (JSX)', 'TypeScript', 'TypeScript (JSX)']],
    ])
  })

  it('says which fence name or extension a language was found by, marking what matched', () => {
    const [bash] = languageOptions('zsh', [])[0]?.options ?? []
    expect(bash).toEqual({
      id: 'language:bash',
      label: 'Bash',
      via: { text: 'zsh', match: { start: 0, end: 3 } },
    })
    expect(languageOptions('golan', [])[0]?.options[0]?.via).toEqual({
      text: 'golang',
      match: { start: 0, end: 5 },
    })
    expect(languageOptions('.ym', [])[0]?.options[0]?.via).toEqual({
      text: '.yml',
      match: { start: 0, end: 3 },
    })
    expect(languageOptions('Pyth', [])[0]?.options[0]).toEqual({
      id: 'language:python',
      label: 'Python',
      labelMatch: { start: 0, end: 4 },
    })
    expect(languageOptions('main.go', [])[0]?.options[0]).toEqual({
      id: 'language:go',
      label: 'Go',
    })
  })

  it('ranks an exact name, then a label’s start, a fence name’s start, an extension, and the rest', () => {
    // `ts` is TypeScript's own fence name; TypeScript (JSX) only starts with it.
    expect(ranked('ts').slice(0, 2)).toEqual(['TypeScript', 'TypeScript (JSX)'])
    // A label that starts with the query beats a fence name that does (`dotnet`).
    expect(ranked('do')).toEqual(['Dockerfile', 'C#', 'Markdown'])
    // An extension beats a label that only contains the query.
    expect(ranked('ym')).toEqual(['YAML'])
    expect(ranked('script')).toEqual([
      'JavaScript',
      'JavaScript (JSX)',
      'TypeScript',
      'TypeScript (JSX)',
    ])
    // The group holding the best match comes first, whatever the category order.
    expect(languageOptions('sh', [])[0]?.label).toBe('Shell')
  })

  it('offers plain text by name', () => {
    expect(firstOf('plain')).toBe('plain')
    expect(firstOf('text')).toBe('plain')
  })

  it('offers a fence name nothing knows, as written, and nothing for what is no fence name', () => {
    expect(languageOptions('PowerShell', [])).toEqual([
      {
        id: 'fence',
        label: 'As written',
        options: [
          {
            id: 'fence:PowerShell',
            label: 'PowerShell',
            detail: 'Kept as written, shown as plain text',
          },
        ],
      },
    ])
    expect(languageOptions('not a language', [])).toEqual([])
  })
})

describe('fenceNameOf', () => {
  it('reads the fence name each option writes', () => {
    expect(fenceNameOf('language:go')).toBe('go')
    expect(fenceNameOf('recent:rust')).toBe('rust')
    expect(fenceNameOf('plain')).toBeNull()
    expect(fenceNameOf('fence:PowerShell')).toBe('PowerShell')
    expect(fenceNameOf('nonsense')).toBeUndefined()
  })
})

describe('languageName', () => {
  it('names a language, a fence nothing knows, and no language at all', () => {
    expect(languageName('ts')).toBe('TypeScript')
    expect(languageName('kotlin')).toBe('kotlin')
    expect(languageName('')).toBeUndefined()
    expect(languageName(null)).toBeUndefined()
  })
})

describe('changesLanguage', () => {
  it('leaves a fence alone when the language chosen is the one it already names', () => {
    expect(changesLanguage('sh', 'bash')).toBe(false)
    expect(changesLanguage('yml', 'yaml')).toBe(false)
    expect(changesLanguage('kotlin', 'kotlin')).toBe(false)
    expect(changesLanguage(null, null)).toBe(false)
    expect(changesLanguage('', null)).toBe(false)
  })

  it('changes it for a different language, plain text, or from a fence nothing knows', () => {
    expect(changesLanguage('sh', 'python')).toBe(true)
    expect(changesLanguage('sh', null)).toBe(true)
    expect(changesLanguage(null, 'go')).toBe(true)
    expect(changesLanguage('kotlin', 'go')).toBe(true)
  })
})
