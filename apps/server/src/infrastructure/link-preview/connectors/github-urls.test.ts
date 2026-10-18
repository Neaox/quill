import { describe, expect, it } from 'vitest'

import { parseGitHubUrl } from './github-urls.ts'

const SHA = 'a'.repeat(40)
const parse = (url: string) => parseGitHubUrl(new URL(url))

describe('parseGitHubUrl: the shapes a connector previews', () => {
  it.each([
    ['https://github.com/octocat/Hello-World', { kind: 'repository' }],
    ['https://github.com/octocat/Hello-World/', { kind: 'repository' }],
    ['https://www.github.com/octocat/Hello-World?tab=readme', { kind: 'repository' }],
    ['https://github.com/octocat/Hello-World/pull/42', { kind: 'pull', number: 42 }],
    ['https://github.com/octocat/Hello-World/pull/42/files', { kind: 'pull', number: 42 }],
    ['https://github.com/octocat/Hello-World/issues/7', { kind: 'issue', number: 7 }],
    [
      'https://github.com/octocat/Hello-World/issues/7#issuecomment-1',
      { kind: 'issue', number: 7 },
    ],
  ])('reads %s', (url, expected) => {
    expect(parse(url)).toMatchObject({ owner: 'octocat', repo: 'Hello-World', ...expected })
  })

  it('reads a code permalink with its line range, and a single line as a range of one', () => {
    expect(parse(`https://github.com/o/r/blob/${SHA}/src/a.ts#L10-L20`)).toEqual({
      kind: 'code',
      owner: 'o',
      repo: 'r',
      sha: SHA,
      path: 'src/a.ts',
      lines: { start: 10, end: 20 },
    })
    expect(parse(`https://github.com/o/r/blob/${SHA}/a.ts#L7`)).toMatchObject({
      lines: { start: 7, end: 7 },
    })
  })

  it('puts a reversed range in order, and reads a permalink with no range as the whole file', () => {
    expect(parse(`https://github.com/o/r/blob/${SHA}/a.ts#L20-L10`)).toMatchObject({
      lines: { start: 10, end: 20 },
    })
    expect(parse(`https://github.com/o/r/blob/${SHA}/a.ts`)).toMatchObject({ lines: null })
    expect(parse(`https://github.com/o/r/blob/${SHA}/a.ts#readme`)).toMatchObject({ lines: null })
  })

  it('reads percent-encoded path segments, and keeps them as segments', () => {
    expect(parse(`https://github.com/o/r/blob/${SHA}/docs/my%20file.md#L1`)).toMatchObject({
      path: 'docs/my file.md',
    })
  })

  it('never sees a dot segment: the URL parser has already resolved it', () => {
    expect(parse(`https://github.com/o/r/blob/${SHA}/a/../b.ts`)).toMatchObject({ path: 'b.ts' })
  })

  it('accepts a 64-character commit id', () => {
    expect(parse(`https://github.com/o/r/blob/${'b'.repeat(64)}/a.ts`)).toMatchObject({
      kind: 'code',
    })
  })

  it.each([
    ['a branch is not a permalink', 'https://github.com/o/r/blob/main/src/a.ts#L1'],
    ['an abbreviated commit id', 'https://github.com/o/r/blob/abc1234/src/a.ts'],
    ['a blob with no path', `https://github.com/o/r/blob/${SHA}`],
    ['an encoded dot segment', `https://github.com/o/r/blob/${SHA}/%2e%2e/b.ts`],
    ['an encoded slash', `https://github.com/o/r/blob/${SHA}/a%2Fb.ts`],
    ['an encoded backslash', `https://github.com/o/r/blob/${SHA}/a%5Cb.ts`],
    ['an encoded control character', `https://github.com/o/r/blob/${SHA}/a%00b.ts`],
    ['an empty path segment', `https://github.com/o/r/blob/${SHA}/a//b.ts`],
    ['a malformed escape', `https://github.com/o/r/blob/${SHA}/a%zz.ts`],
    ['a pull request number that is not a number', 'https://github.com/o/r/pull/abc'],
    ['an enormous number', 'https://github.com/o/r/pull/99999999999'],
    ['a zero number', 'https://github.com/o/r/pull/0'],
    ['a section that is not previewed', 'https://github.com/o/r/actions'],
    ['a tree', `https://github.com/o/r/tree/${SHA}/src`],
    ['an owner alone', 'https://github.com/octocat'],
    ['the front page', 'https://github.com/'],
    ['a reserved first segment', 'https://github.com/settings/profile'],
    ['an owner that is not a GitHub name', 'https://github.com/-bad/repo'],
    ['an owner with a dot', 'https://github.com/a.b/repo'],
    ['a repository named like a dot segment', 'https://github.com/o/..'],
    ['a repository with an unlikely character', 'https://github.com/o/r%20x'],
    ['another host', 'https://example.com/o/r'],
    ['a look-alike host', 'https://github.com.evil.example/o/r'],
    ['a gist', 'https://gist.github.com/o/abc'],
  ])('does not read %s', (_name, url) => {
    expect(parse(url)).toBeNull()
  })
})
