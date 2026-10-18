import { describe, expect, it } from 'vitest'

import {
  conflictMarkers,
  deletionMarkers,
  OURS_LABEL,
  THEIRS_LABEL,
  threeWayMerge,
} from './three-way-merge.ts'

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

  it('combines edits to neighbouring blocks, as the draft merge does (ADR-021)', () => {
    expect(
      threeWayMerge(
        '# Title\n\nAlpha.\n\nBravo.\n',
        '# Title\n\nAlpha, ours.\n\nBravo.\n',
        '# Title\n\nAlpha.\n\nBravo, theirs.\n',
      ),
    ).toEqual({ clean: true, text: '# Title\n\nAlpha, ours.\n\nBravo, theirs.\n' })
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

describe('conflictMarkers', () => {
  it('writes the two sides of a clash between markers', () => {
    expect(conflictMarkers('a\n', 'b\n', 'c\n')).toBe(
      `<<<<<<< ${OURS_LABEL}\nb\n=======\nc\n>>>>>>> ${THEIRS_LABEL}\n`,
    )
  })
})

describe('threeWayMerge: a conflict only the block merge sees', () => {
  it('marks it block by block, so the merge view always has markers to show', () => {
    const merged = threeWayMerge(
      'Alpha.\n\nBravo.\n\nCharlie.\n',
      'Bravo.\n\nCharlie.\n\nAlpha.\n',
      'Bravo.\n\nCharlie.\n',
    )
    expect(merged).toEqual({
      clean: false,
      text: `Bravo.\n\nCharlie.\n<<<<<<< ${OURS_LABEL}\nAlpha.\n=======\n>>>>>>> ${THEIRS_LABEL}\n`,
    })
  })
})

describe('deletionMarkers', () => {
  it('shows an edit against a deletion as the whole document on one side and nothing on the other', () => {
    expect(deletionMarkers('Ours.\n', '')).toBe(
      `<<<<<<< ${OURS_LABEL}\nOurs.\n=======\n>>>>>>> ${THEIRS_LABEL}\n`,
    )
  })

  it('shows a deletion against an edit the same way round', () => {
    expect(deletionMarkers('', 'Theirs.\n')).toBe(
      `<<<<<<< ${OURS_LABEL}\n=======\nTheirs.\n>>>>>>> ${THEIRS_LABEL}\n`,
    )
  })

  it('ends every line it writes, so a side without a final newline cannot swallow a marker', () => {
    expect(deletionMarkers('Ours.', '')).toBe(
      `<<<<<<< ${OURS_LABEL}\nOurs.\n=======\n>>>>>>> ${THEIRS_LABEL}\n`,
    )
  })

  it('is a conflict even where a line merge would have called it clean', () => {
    // The merge engine reads a deletion as removing every line, which does not
    // clash with an edit it can place; a person still has to choose.
    expect(threeWayMerge('Base.\n', 'Ours.\n', '').clean).toBe(true)
    expect(deletionMarkers('Ours.\n', '')).toContain('<<<<<<<')
  })
})
