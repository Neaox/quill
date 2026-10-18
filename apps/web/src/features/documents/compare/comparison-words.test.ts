import { describe, expect, it } from 'vitest'

import type { LabelledRevision } from '../../../lib/documents/revision-labels.ts'
import { comparisonTitle, describeChange, sideLabel, summarise } from './comparison-words.ts'

const SUMMARY = {
  sections: 3,
  added: 2,
  removed: 1,
  changed: 4,
  moved: 0,
  wordsAdded: 140,
  wordsRemoved: 1,
}

const REVISIONS: readonly LabelledRevision[] = [
  {
    revision: 'b'.repeat(40),
    label: 'v2',
    date: '2026-02-03',
    summary: '',
    changeNote: undefined,
    authorName: 'Ada',
  },
  {
    revision: 'a'.repeat(40),
    label: 'v1',
    date: '2026-01-02',
    summary: '',
    changeNote: undefined,
    authorName: 'Sam',
  },
]

describe('summarise', () => {
  it('says what changed in words, leaving out what did not happen', () => {
    expect(summarise(SUMMARY)).toBe(
      '3 sections changed · 2 added · 1 removed · 4 edited · 140 words added · 1 word removed',
    )
  })

  it('says so when nothing changed', () => {
    expect(
      summarise({
        sections: 0,
        added: 0,
        removed: 0,
        changed: 0,
        moved: 0,
        wordsAdded: 0,
        wordsRemoved: 0,
      }),
    ).toBe('No differences')
  })
})

describe('sideLabel', () => {
  it('names a revision by its version, the draft as yours, and nothing as empty', () => {
    expect(sideLabel(REVISIONS, 'a'.repeat(40))).toBe('v1')
    expect(sideLabel(REVISIONS, 'draft')).toBe('your draft')
    expect(sideLabel(REVISIONS, null)).toBe('an empty document')
    expect(sideLabel(REVISIONS, 'c'.repeat(40))).toBe('ccccccc')
  })
})

describe('comparisonTitle', () => {
  it('reads as a sentence', () => {
    expect(comparisonTitle(REVISIONS, { from: 'a'.repeat(40), to: 'b'.repeat(40) })).toBe(
      'Changes between v1 and v2',
    )
    expect(comparisonTitle(REVISIONS, { from: null, to: 'a'.repeat(40) })).toBe('Everything in v1')
    expect(comparisonTitle(REVISIONS, { from: 'b'.repeat(40), to: 'draft' })).toBe(
      'Changes between v2 and your draft',
    )
  })
})

describe('describeChange', () => {
  it('says what happened to which kind of block', () => {
    expect(describeChange({ change: 'added', block: 'paragraph' })).toBe('Paragraph added')
    expect(describeChange({ change: 'changed', block: 'table' })).toBe('Table edited')
    expect(describeChange({ change: 'moved', block: 'code' })).toBe('Code block moved')
  })
})
