import { describe, expect, it } from 'vitest'

import { diffLines } from './revision-diff-view.tsx'

const UNIFIED = [
  '--- a/runbooks/failover.md',
  '+++ b/runbooks/failover.md',
  '@@ -1,3 +1,3 @@',
  ' Move traffic east.',
  '-Then wait.',
  '+Then west.',
].join('\n')

describe('diffLines', () => {
  it('classifies every line of a unified diff by what it is', () => {
    expect(diffLines(UNIFIED).map((line) => line.change)).toEqual([
      'file',
      'file',
      'hunk',
      'context',
      'removed',
      'added',
    ])
  })

  it('keeps the leading marker, so the change is never only a colour', () => {
    const added = diffLines(UNIFIED).find((line) => line.change === 'added')

    expect(added?.text).toBe('+Then west.')
  })

  it('has nothing to show for two identical revisions', () => {
    expect(diffLines('')).toEqual([])
  })

  it('keys lines by position, because a diff repeats itself', () => {
    const repeated = diffLines('+same\n+same')

    expect(new Set(repeated.map((line) => line.key)).size).toBe(2)
  })
})
