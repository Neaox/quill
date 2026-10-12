import { describe, expect, it } from 'vitest'

import { mergeMarkdown } from './merge-markdown.ts'

describe('mergeMarkdown', () => {
  const base = '# Plan\n\nFirst.\n\nSecond.\n'

  it('returns theirs untouched when mine is unchanged or the same as theirs', () => {
    const theirs = '# Plan\n\nFirst.\n\nSecond,  spaced.\n'
    expect(mergeMarkdown(base, base, theirs)).toEqual({ clean: true, markdown: theirs })
    expect(mergeMarkdown(base, theirs, theirs)).toEqual({ clean: true, markdown: theirs })
  })

  it('returns mine untouched when theirs is unchanged', () => {
    const mine = '# Plan\n\n* First.\n'
    expect(mergeMarkdown(base, mine, base)).toEqual({ clean: true, markdown: mine })
  })

  it('writes a clean merge with the one serialiser', () => {
    expect(
      mergeMarkdown(
        base,
        '# Plan\n\nFirst, mine.\n\nSecond.\n',
        '# Plan\n\nFirst.\n\nSecond, theirs.\n',
      ),
    ).toEqual({
      clean: true,
      markdown: '# Plan\n\nFirst, mine.\n\nSecond, theirs.\n',
    })
  })

  it('merges lines a line merge would call a conflict, because they are words of one paragraph', () => {
    expect(mergeMarkdown('a\nb\nc\n', 'a\nc\n', 'a\nb\nB\nc\n')).toEqual({
      clean: true,
      markdown: 'a\nB\nc\n',
    })
  })

  it('hands back the merge, conflicts and all, when it is not clean', () => {
    const result = mergeMarkdown(
      base,
      '# Plan\n\nMine.\n\nSecond.\n',
      '# Plan\n\nTheirs.\n\nSecond.\n',
    )
    expect(result.clean).toBe(false)
    expect(result.clean ? [] : result.merge.conflicts).toHaveLength(1)
  })
})
