import { describe, expect, it } from 'vitest'

import { Prism } from './grammars.ts'
import {
  CODE_LANGUAGES,
  LANGUAGE_CATEGORIES,
  SUPPORTED_LANGUAGES,
  languageForFile,
  languageLabel,
  resolveCodeLanguage,
  resolveLanguage,
} from './languages.ts'

describe('the language registry', () => {
  it('gives every language a registered grammar', () => {
    for (const language of CODE_LANGUAGES) {
      expect(Prism.languages[language.grammar], `no grammar for ${language.id}`).toBeDefined()
    }
  })

  it('registers no grammar that no language uses', () => {
    expect(new Set(SUPPORTED_LANGUAGES)).toEqual(
      new Set(CODE_LANGUAGES.map((language) => language.grammar)),
    )
  })

  it('claims every fence name and every extension once', () => {
    const names = CODE_LANGUAGES.flatMap((language) => [language.id, ...language.aliases])
    expect(new Set(names).size).toBe(names.length)
    const extensions = CODE_LANGUAGES.flatMap((language) => language.extensions)
    expect(new Set(extensions).size).toBe(extensions.length)
    const labels = CODE_LANGUAGES.map((language) => language.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('writes names and extensions in lower case, so lookup can fold case once', () => {
    for (const language of CODE_LANGUAGES) {
      for (const name of [language.id, ...language.aliases, ...language.extensions]) {
        expect(name).toBe(name.toLowerCase())
      }
    }
  })

  it('lists languages alphabetically by label, each in a known category', () => {
    const labels = CODE_LANGUAGES.map((language) => language.label)
    expect(labels).toEqual(labels.toSorted((a, b) => a.localeCompare(b, 'en')))
    for (const language of CODE_LANGUAGES) {
      expect(LANGUAGE_CATEGORIES).toContain(language.category)
    }
  })

  it('resolves each grammar key, because `data-lang` carries the tokenizer’s key', () => {
    for (const grammar of SUPPORTED_LANGUAGES) {
      expect(resolveCodeLanguage(grammar)?.grammar).toBe(grammar)
    }
  })
})

describe('resolveCodeLanguage', () => {
  it.each([
    ['ts', 'typescript'],
    ['sh', 'bash'],
    ['shell', 'bash'],
    ['zsh', 'bash'],
    ['console', 'bash'],
    ['curl', 'bash'],
    ['cs', 'csharp'],
    ['c#', 'csharp'],
    ['golang', 'go'],
    ['yml', 'yaml'],
    ['dockerfile', 'docker'],
    ['markup', 'html'],
    ['xml', 'html'],
    ['rs', 'rust'],
    ['py', 'python'],
    ['patch', 'diff'],
  ])('reads the fence name %s as %s', (name, id) => {
    expect(resolveCodeLanguage(name)?.id).toBe(id)
  })

  it('folds case and whitespace', () => {
    expect(resolveCodeLanguage('  TS ')?.id).toBe('typescript')
    expect(resolveCodeLanguage('YAML')?.id).toBe('yaml')
  })

  it('knows nothing of an unknown, empty or missing name', () => {
    expect(resolveCodeLanguage('cobol')).toBeUndefined()
    expect(resolveCodeLanguage('')).toBeUndefined()
    expect(resolveCodeLanguage(null)).toBeUndefined()
    expect(resolveCodeLanguage(undefined)).toBeUndefined()
  })
})

describe('resolveLanguage', () => {
  it('gives the grammar key the tokenizer is called with', () => {
    expect(resolveLanguage('html')).toBe('markup')
    expect(resolveLanguage('Dockerfile')).toBe('docker')
    expect(resolveLanguage('c#')).toBe('csharp')
    expect(resolveLanguage('cobol')).toBeNull()
  })
})

describe('languageLabel', () => {
  it('names a known language, and nothing else', () => {
    expect(languageLabel('ts')).toBe('TypeScript')
    expect(languageLabel('markup')).toBe('HTML')
    expect(languageLabel('kotlin')).toBeUndefined()
    expect(languageLabel(null)).toBeUndefined()
  })
})

describe('languageForFile', () => {
  it.each([
    ['main.go', 'go'],
    ['src/lib.rs', 'rust'],
    ['Program.cs', 'csharp'],
    ['app.component.TS', 'typescript'],
    ['install.sh', 'bash'],
    ['docker-compose.yml', 'yaml'],
    ['Cargo.toml', 'toml'],
    ['Dockerfile', 'docker'],
    ['build/Containerfile', 'docker'],
    ['fix.patch', 'diff'],
  ])('infers %s as %s', (file, id) => {
    expect(languageForFile(file)?.id).toBe(id)
  })

  it('infers nothing from a file it cannot place', () => {
    expect(languageForFile('README')).toBeUndefined()
    expect(languageForFile('notes.txt')).toBeUndefined()
    expect(languageForFile('archive.')).toBeUndefined()
    expect(languageForFile('')).toBeUndefined()
  })
})
