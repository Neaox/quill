import { describe, expect, it } from 'vitest'

import { decodeCommit, encodeCommit, sanitiseIdentity, UTC, type GitCommit } from './commit.ts'
import { GitObjectError } from './objects.ts'

const TREE = '520c9f9f61657ca1e65a288ea77d229a27a8171b'
const PARENT = 'ce013625030ba8dba906f756967f9e9ca394464a'

const commit = (overrides: Partial<GitCommit> = {}): GitCommit => ({
  tree: TREE,
  parents: [],
  author: { name: 'Ada Lovelace', email: 'ada@example.com', when: 1_700_000_000, timezone: UTC },
  committer: {
    name: 'Committer',
    email: 'bot@example.invalid',
    when: 1_700_000_001,
    timezone: UTC,
  },
  message: 'Update Onboarding\n',
  ...overrides,
})

describe('encodeCommit', () => {
  it('writes headers, a blank line, then the message', () => {
    expect(encodeCommit(commit()).toString('utf8')).toBe(
      [
        `tree ${TREE}`,
        'author Ada Lovelace <ada@example.com> 1700000000 +0000',
        'committer Committer <bot@example.invalid> 1700000001 +0000',
        '',
        'Update Onboarding',
        '',
      ].join('\n'),
    )
  })

  it('terminates a message that does not end in a newline', () => {
    const encoded = encodeCommit(commit({ message: 'No newline' })).toString('utf8')
    expect(encoded.endsWith('No newline\n')).toBe(true)
  })

  it('writes one parent line per parent', () => {
    const encoded = encodeCommit(commit({ parents: [PARENT] })).toString('utf8')
    expect(encoded).toContain(`parent ${PARENT}\n`)
  })
})

describe('identity sanitising', () => {
  it('refuses to let a display name forge a commit header', () => {
    const forged = encodeCommit(
      commit({
        author: {
          name: `Mallory\nparent ${PARENT}`,
          email: 'mallory@example.com',
          when: 1,
          timezone: UTC,
        },
      }),
    ).toString('utf8')
    expect(forged.split('\n').filter((line) => line.startsWith('parent '))).toEqual([])
    expect(forged).toContain(`author Malloryparent ${PARENT} <mallory@example.com> 1 +0000\n`)
    expect(decodeCommit(Buffer.from(forged)).parents).toEqual([])
  })

  it('refuses to let an email close its own angle bracket', () => {
    const encoded = encodeCommit(
      commit({
        author: {
          name: 'Ada',
          email: 'ada@example.com> <evil@example.com',
          when: 1,
          timezone: UTC,
        },
      }),
    ).toString('utf8')
    expect(encoded).toContain('author Ada <ada@example.com evil@example.com> 1 +0000\n')
  })

  it('drops a NUL, which would truncate the header for a C reader', () => {
    expect(sanitiseIdentity({ name: 'A\0da', email: 'a@b', when: 1, timezone: UTC }).name).toBe(
      'Ada',
    )
  })

  it('falls back to a placeholder when nothing usable is left', () => {
    expect(sanitiseIdentity({ name: ' <> ', email: '\n', when: 1, timezone: UTC })).toEqual({
      name: 'Unknown',
      email: 'unknown@invalid',
      when: 1,
      timezone: UTC,
    })
  })

  it('round-trips a sanitised identity through a decode', () => {
    const dirty = commit({
      author: { name: '  Ada <Lovelace>  ', email: 'ada@example.com', when: 7, timezone: UTC },
    })
    expect(decodeCommit(encodeCommit(dirty)).author).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      when: 7,
      timezone: UTC,
    })
  })
})

describe('decodeCommit', () => {
  it('round-trips a commit', () => {
    const original = commit({ parents: [PARENT], message: 'Subject\n\nBody\n' })
    expect(decodeCommit(encodeCommit(original))).toEqual(original)
  })

  it('round-trips Unicode in names, emails, and messages', () => {
    const original = commit({
      author: { name: 'Zoë Müller', email: 'zoë@example.com', when: 1, timezone: '+0530' },
      message: 'Größe — ドキュメント 📄\n',
    })
    expect(decodeCommit(encodeCommit(original))).toEqual(original)
  })

  it('ignores headers it does not know, such as gpgsig or encoding', () => {
    const raw = Buffer.from(
      `tree ${TREE}\nencoding ISO-8859-1\nauthor A <a@b> 1 +0000\ncommitter A <a@b> 1 +0000\n\nHi\n`,
      'utf8',
    )
    expect(decodeCommit(raw).tree).toBe(TREE)
  })

  it('rejects a commit with no blank line before its message', () => {
    expect(() => decodeCommit(Buffer.from(`tree ${TREE}\n`))).toThrow(/no message separator/)
  })

  it('rejects a commit missing a tree, an author, or a committer', () => {
    expect(() => decodeCommit(Buffer.from(`tree ${TREE}\n\nHi\n`))).toThrow(GitObjectError)
  })

  it.each([
    ['no email', 'Ada'],
    ['an unterminated email', 'Ada <ada@example.com'],
    ['a non-numeric timestamp', 'Ada <ada@example.com> when +0000'],
  ])('rejects an identity with %s', (_reason, identity) => {
    const raw = `tree ${TREE}\nauthor ${identity}\ncommitter A <a@b> 1 +0000\n\nHi\n`
    expect(() => decodeCommit(Buffer.from(raw))).toThrow(/Malformed identity/)
  })
})
