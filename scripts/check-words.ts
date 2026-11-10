/**
 * Fails when a word the repository must never hold appears anywhere in it:
 * in a file's contents or in its path, in any letter case. The words are
 * names of private projects that are not Quill's to publish.
 *
 * Every file Git would commit is read: the tracked files and the untracked
 * ones that are not ignored. Each word is kept here in parts, so this file
 * does not hold it whole and the check can read itself.
 *
 * Usage: node scripts/check-words.ts
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The words, each written in parts. */
export const BANNED_WORDS: readonly string[] = [['lock', 'stay']].map((parts) => parts.join(''))

export interface WordHit {
  readonly path: string
  /** The line the word is on, from one; zero when the word is in the path. */
  readonly line: number
  readonly word: string
}

/** Where each word appears in one file: its path first, then each line of its text. */
export function findWords(
  path: string,
  text: string,
  words: readonly string[] = BANNED_WORDS,
): WordHit[] {
  const hits: WordHit[] = []
  const lowerPath = path.toLowerCase()
  for (const word of words) {
    if (lowerPath.includes(word)) hits.push({ path, line: 0, word })
  }
  const lines = text.toLowerCase().split('\n')
  for (const [index, line] of lines.entries()) {
    for (const word of words) {
      if (line.includes(word)) hits.push({ path, line: index + 1, word })
    }
  }
  return hits
}

/** The files Git would commit under `root`: tracked, and untracked but not ignored. */
export function repositoryFiles(root: string): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return [...new Set(listed.split('\0').filter((path) => path !== ''))]
}

/** Every hit in the repository at `root`. A file listed but gone (deleted, not yet staged) is skipped. */
export function checkWords(root: string, words: readonly string[] = BANNED_WORDS): WordHit[] {
  return repositoryFiles(root).flatMap((path) => {
    let text: string
    try {
      text = readFileSync(join(root, path), 'latin1')
    } catch {
      return findWords(path, '', words)
    }
    return findWords(path, text, words)
  })
}

function main(): void {
  const hits = checkWords(process.cwd())
  if (hits.length === 0) {
    console.log('check:words: no banned words.')
    return
  }
  for (const hit of hits) {
    const where = hit.line === 0 ? `${hit.path} (its path)` : `${hit.path}:${hit.line}`
    console.error(`${where}: a banned word`)
  }
  console.error(
    `check:words: ${hits.length} occurrence(s) of a banned word. Remove them; see scripts/check-words.ts.`,
  )
  process.exit(1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
