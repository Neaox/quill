import { describe, expect, it } from 'vitest'

import {
  MAX_SOURCE_BRANCH_LENGTH,
  MAX_SOURCE_PATH_LENGTH,
  MAX_SOURCE_REMOTE_LENGTH,
  MAX_SOURCE_USERNAME_LENGTH,
  checkSourceBranch,
  checkSourcePath,
  checkSourceRemote,
  checkSourceUsername,
} from './workspace-source.ts'

const HTTPS_ONLY = { allowFileRemotes: false }

describe('checkSourceRemote', () => {
  it('accepts an https address and answers it normalised', () => {
    expect(checkSourceRemote('https://GitHub.com/acme/docs.git', HTTPS_ONLY)).toEqual({
      ok: true,
      value: 'https://github.com/acme/docs.git',
    })
  })

  it.each([
    ['http://github.com/acme/docs.git', 'https://'],
    ['ssh://git@github.com/acme/docs.git', 'https://'],
    ['git://github.com/acme/docs.git', 'https://'],
    ['file:///srv/docs.git', 'https://'],
    ['https://token@github.com/acme/docs.git', 'user name or password'],
    ['https://user:secret@github.com/acme/docs.git', 'user name or password'],
    ['https://github.com/acme/docs.git?ref=main', 'query or a fragment'],
    ['https://github.com/acme/docs.git#main', 'query or a fragment'],
    ['github.com/acme/docs', 'not an address'],
  ])('refuses %s', (remote, reason) => {
    expect(checkSourceRemote(remote, HTTPS_ONLY)).toEqual({
      ok: false,
      error: expect.stringContaining(reason),
    })
  })

  it('accepts a file address only when tests allow it', () => {
    expect(checkSourceRemote('file:///srv/docs.git', { allowFileRemotes: true })).toEqual({
      ok: true,
      value: 'file:///srv/docs.git',
    })
  })

  it('refuses an address that is too long', () => {
    const remote = `https://example.com/${'a'.repeat(MAX_SOURCE_REMOTE_LENGTH)}`
    expect(checkSourceRemote(remote, HTTPS_ONLY).ok).toBe(false)
  })
})

describe('checkSourceBranch', () => {
  it.each(['main', 'release/2026', 'docs-v2'])('accepts %s', (branch) => {
    expect(checkSourceBranch(branch)).toEqual({ ok: true, value: branch })
  })

  it.each(['', '-main', '--upload-pack=x', 'a..b', 'a b', 'main.lock', 'main/', 'a@{1}', 'a:b'])(
    'refuses %j',
    (branch) => {
      expect(checkSourceBranch(branch).ok).toBe(false)
    },
  )

  it('refuses a name that is too long', () => {
    expect(checkSourceBranch('a'.repeat(MAX_SOURCE_BRANCH_LENGTH + 1)).ok).toBe(false)
  })
})

describe('checkSourcePath', () => {
  it('accepts a directory or a file and drops a trailing slash', () => {
    expect(checkSourcePath('docs/guides/')).toEqual({ ok: true, value: 'docs/guides' })
    expect(checkSourcePath('README.md')).toEqual({ ok: true, value: 'README.md' })
    expect(checkSourcePath('docs/my guides')).toEqual({ ok: true, value: 'docs/my guides' })
  })

  it.each(['', '/docs', 'docs//guides', './docs', 'docs/../secrets', 'docs\\guides', 'a\u0000b'])(
    'refuses %j as not a plain relative path',
    (path) => {
      expect(checkSourcePath(path)).toEqual({
        ok: false,
        error: expect.stringContaining('plain segments'),
      })
    },
  )

  it.each(['docs/**', 'packages/*/README.md', 'docs/?', 'docs/[ab]', 'docs/{a,b}'])(
    'refuses the glob %s',
    (path) => {
      expect(checkSourcePath(path)).toEqual({ ok: false, error: expect.stringContaining('glob') })
    },
  )

  it('refuses a path that is too long', () => {
    expect(checkSourcePath('a'.repeat(MAX_SOURCE_PATH_LENGTH + 1)).ok).toBe(false)
  })
})

describe('checkSourceUsername', () => {
  it('accepts a user name', () => {
    expect(checkSourceUsername('x-access-token')).toEqual({ ok: true, value: 'x-access-token' })
  })

  it.each(['', 'a:b', 'a\nb', 'a'.repeat(MAX_SOURCE_USERNAME_LENGTH + 1)])('refuses %j', (name) => {
    expect(checkSourceUsername(name).ok).toBe(false)
  })
})
