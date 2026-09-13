import { describe, expect, it } from 'vitest'

import { OURS_LABEL, THEIRS_LABEL, threeWayMerge } from './three-way-merge.ts'

const BASE = 'one\ntwo\nthree\nfour\nfive\n'

describe('threeWayMerge', () => {
  it('keeps both sides when they changed different parts', () => {
    const ours = 'ONE\ntwo\nthree\nfour\nfive\n'
    const theirs = 'one\ntwo\nthree\nfour\nFIVE\n'
    const merged = threeWayMerge(BASE, ours, theirs)
    expect(merged.clean).toBe(true)
    expect(merged.text).toBe('ONE\ntwo\nthree\nfour\nFIVE\n')
  })

  it('is a no-op when neither side changed anything', () => {
    expect(threeWayMerge(BASE, BASE, BASE)).toEqual({ clean: true, text: BASE })
  })

  it('accepts identical edits on both sides without calling them a conflict', () => {
    const both = 'one\nTWO\nthree\nfour\nfive\n'
    expect(threeWayMerge(BASE, both, both)).toEqual({ clean: true, text: both })
  })

  it('marks a conflict with labelled markers when both sides changed one line', () => {
    const merged = threeWayMerge(
      BASE,
      'one\nours\nthree\nfour\nfive\n',
      'one\ntheirs\nthree\nfour\nfive\n',
    )
    expect(merged.clean).toBe(false)
    expect(merged.text).toContain(`<<<<<<< ${OURS_LABEL}`)
    expect(merged.text).toContain('=======')
    expect(merged.text).toContain(`>>>>>>> ${THEIRS_LABEL}`)
    expect(merged.text).toContain('ours')
    expect(merged.text).toContain('theirs')
  })

  it('merges an empty base, which is what a new document has', () => {
    expect(threeWayMerge('', '', 'theirs\n').text).toBe('theirs\n')
  })
})
