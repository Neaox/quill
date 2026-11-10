import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { BANNED_WORDS, checkWords, findWords } from './check-words.ts'

const WORDS = ['quokka']

describe('findWords', () => {
  it('finds a word on any line, in any letter case', () => {
    expect(findWords('a.md', 'One\nA QUOKKA here\nquokka-shaped\n', WORDS)).toEqual([
      { path: 'a.md', line: 2, word: 'quokka' },
      { path: 'a.md', line: 3, word: 'quokka' },
    ])
  })

  it('finds a word in the path', () => {
    expect(findWords('docs/Quokka/a.md', 'clean\n', WORDS)).toEqual([
      { path: 'docs/Quokka/a.md', line: 0, word: 'quokka' },
    ])
  })

  it('finds nothing in text without the word', () => {
    expect(findWords('a.md', 'A wallaby.\n', WORDS)).toEqual([])
  })

  it('holds at least one word, none of them empty', () => {
    expect(BANNED_WORDS.length).toBeGreaterThan(0)
    expect(BANNED_WORDS.every((word) => word.length > 0 && word === word.toLowerCase())).toBe(true)
  })
})

describe('checkWords', () => {
  it('reads tracked and untracked files, and skips ignored ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'quill-check-words-'))
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root })
      writeFileSync(join(root, '.gitignore'), 'ignored.md\n')
      writeFileSync(join(root, 'tracked.md'), 'A Quokka.\n')
      execFileSync('git', ['add', 'tracked.md', '.gitignore'], { cwd: root })
      writeFileSync(join(root, 'untracked.md'), 'clean\nquokka\n')
      writeFileSync(join(root, 'ignored.md'), 'quokka\n')
      expect(checkWords(root, WORDS).toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
        { path: 'tracked.md', line: 1, word: 'quokka' },
        { path: 'untracked.md', line: 2, word: 'quokka' },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('finds nothing in this repository', () => {
    expect(checkWords(process.cwd())).toEqual([])
  })
})
