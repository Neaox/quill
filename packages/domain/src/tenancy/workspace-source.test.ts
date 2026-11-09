import { describe, expect, it } from 'vitest'

import {
  MAX_SOURCE_BRANCH_LENGTH,
  MAX_SOURCE_MANIFEST_ENTRY_LENGTH,
  MAX_SOURCE_PATH_LENGTH,
  MAX_SOURCE_REMOTE_LENGTH,
  MAX_SOURCE_USERNAME_LENGTH,
  checkSourceBranch,
  checkSourceManifestEntry,
  checkSourcePath,
  checkSourcePattern,
  checkSourceRemote,
  checkSourceUsername,
  isSourceGlob,
  sourcePatternMatcher,
  sourcePatternPrefix,
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

describe('checkSourcePattern', () => {
  it.each([
    ['docs/guides/', 'docs/guides'],
    ['README.md', 'README.md'],
    ['packages/**/README.md', 'packages/**/README.md'],
    ['docs/*.md', 'docs/*.md'],
    ['docs/adr/00??-*.md', 'docs/adr/00??-*.md'],
    ['docs/**', 'docs/**'],
  ])('accepts %s', (pattern, value) => {
    expect(checkSourcePattern(pattern)).toEqual({ ok: true, value })
  })

  it.each(['', '/docs', 'docs/../x', 'docs\\a'])(
    'refuses %j as not a plain relative path',
    (pattern) => {
      expect(checkSourcePattern(pattern)).toEqual({
        ok: false,
        error: expect.stringContaining('plain segments'),
      })
    },
  )

  it.each(['docs/[ab].md', 'docs/{a,b}', 'docs/a**', 'docs/**b/c'])(
    'refuses %s, whose wildcard this version does not read',
    (pattern) => {
      expect(checkSourcePattern(pattern)).toEqual({
        ok: false,
        error: expect.stringContaining('wildcard'),
      })
    },
  )

  it.each(['**/*.md', '*.md', 'doc?/a.md'])(
    'refuses %s, which has no directory to widen to',
    (pattern) => {
      expect(checkSourcePattern(pattern)).toEqual({
        ok: false,
        error: expect.stringContaining('no directory'),
      })
    },
  )

  it('refuses a pattern that is too long', () => {
    expect(checkSourcePattern('a'.repeat(MAX_SOURCE_PATH_LENGTH + 1)).ok).toBe(false)
  })
})

describe('isSourceGlob and sourcePatternPrefix', () => {
  it('tell a glob from a path, and find the directory in front of it', () => {
    expect(isSourceGlob('docs/guides')).toBe(false)
    expect(isSourceGlob('packages/**/README.md')).toBe(true)
    expect(sourcePatternPrefix('packages/**/README.md')).toBe('packages')
    expect(sourcePatternPrefix('docs/adr/*.md')).toBe('docs/adr')
    expect(sourcePatternPrefix('docs/guides')).toBe('docs/guides')
  })
})

describe('sourcePatternMatcher', () => {
  it.each([
    ['docs', 'docs/a.md', true],
    ['docs', 'docs', true],
    ['docs', 'docsite/a.md', false],
    ['docs/*', 'docs/a.md', true],
    ['docs/*', 'docs/guides/b.md', true],
    ['docs/*.md', 'docs/a.md', true],
    ['docs/*.md', 'docs/a.txt', false],
    ['docs/*.md', 'docs/guides/b.md', false],
    ['packages/**/README.md', 'packages/README.md', true],
    ['packages/**/README.md', 'packages/ui/README.md', true],
    ['packages/**/README.md', 'packages/ui/src/README.md', true],
    ['packages/**/README.md', 'packages/ui/notes.md', false],
    ['docs/**', 'docs/a/b/c.md', true],
    ['docs/adr/00??-*.md', 'docs/adr/0012-auth.md', true],
    ['docs/adr/00??-*.md', 'docs/adr/012-auth.md', false],
    ['docs/v1.0/*.md', 'docs/v1x0/a.md', false],
    ['docs/v1.0/*.md', 'docs/v1.0/a.md', true],
  ])('%s covers %s: %s', (pattern, path, covered) => {
    expect(sourcePatternMatcher(pattern)(path)).toBe(covered)
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

describe('checkSourceManifestEntry', () => {
  it('accepts a slug a manifest can hold', () => {
    expect(checkSourceManifestEntry('handbook-2')).toEqual({ ok: true, value: 'handbook-2' })
  })

  it.each([
    ['', '1 to'],
    ['x'.repeat(MAX_SOURCE_MANIFEST_ENTRY_LENGTH + 1), '1 to'],
    ['Handbook', 'not a workspace slug'],
    ['hand book', 'not a workspace slug'],
    ['-handbook', 'not a workspace slug'],
  ])('refuses %j', (value, reason) => {
    const checked = checkSourceManifestEntry(value)
    expect(checked.ok).toBe(false)
    expect(checked.ok ? '' : checked.error).toContain(reason)
  })
})
