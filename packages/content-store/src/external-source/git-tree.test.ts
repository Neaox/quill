import type { SourceFile } from '@quill/application'
import { describe, expect, it } from 'vitest'

import { commitRecord, listingChanges, namesWithParents, withinPrefixes } from './git-tree.ts'

const file = (path: string, fileId: string, kind: SourceFile['kind'] = 'file'): SourceFile => ({
  path,
  fileId,
  kind,
})

describe('a commit object', () => {
  it('gives its author, its times, and its first paragraph on one line as the subject', () => {
    const text = [
      'tree 1111111111111111111111111111111111111111',
      'author Ada Author <ada@example.com> 1700000000 +1300',
      'committer Cy Committer <cy@example.com> 1700000100 -0500',
      '',
      'Revise the guide',
      'over two lines',
      '',
      'The body.',
    ].join('\n')
    expect(commitRecord('c1', new TextEncoder().encode(text))).toEqual({
      id: 'c1',
      author: { name: 'Ada Author', email: 'ada@example.com' },
      authoredAt: new Date(1_700_000_000_000),
      committedAt: new Date(1_700_000_100_000),
      subject: 'Revise the guide over two lines',
    })
  })

  it('reads one with no message, and one missing a header, as empty', () => {
    expect(commitRecord('c2', new TextEncoder().encode('tree 1\n'))).toEqual({
      id: 'c2',
      author: { name: '', email: '' },
      authoredAt: new Date(0),
      committedAt: new Date(0),
      subject: '',
    })
  })
})

describe('two listings', () => {
  it('differ by path: added, modified (contents or kind), and removed', () => {
    const before = new Map([
      ['a.md', file('a.md', '1')],
      ['b.md', file('b.md', '2')],
      ['c.md', file('c.md', '3')],
      ['gone.md', file('gone.md', '4')],
    ])
    const after = new Map([
      ['a.md', file('a.md', '1')],
      ['b.md', file('b.md', '9')],
      ['c.md', file('c.md', '3', 'symbolic-link')],
      ['new.md', file('new.md', '5')],
    ])
    expect([...listingChanges(before, after)]).toEqual([
      { kind: 'modified', file: file('b.md', '9') },
      { kind: 'modified', file: file('c.md', '3', 'symbolic-link') },
      { kind: 'added', file: file('new.md', '5') },
      { kind: 'removed', path: 'gone.md' },
    ])
  })
})

describe('names', () => {
  it('include every directory above a path, and a prefix holds what is under it', () => {
    expect([...namesWithParents(['a/b/c.md'])]).toEqual(['a', 'a/b', 'a/b/c.md'])
    expect(withinPrefixes('docs/a.md', ['docs'])).toBe(true)
    expect(withinPrefixes('docs', ['docs'])).toBe(true)
    expect(withinPrefixes('docsx/a.md', ['docs'])).toBe(false)
  })
})
