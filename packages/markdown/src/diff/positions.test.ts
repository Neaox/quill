import { toString } from 'mdast-util-to-string'
import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { compareDocuments } from './compare.ts'

/** The paragraphs of a document, one blank line apart. */
const document = (...blocks: string[]): string => `${blocks.join('\n\n')}\n`

function stands(before: string, after: string) {
  return compareDocuments(parseDocument(before).ast, parseDocument(after).ast).changes.map(
    ({ change, at, previous }) => ({
      change,
      at,
      previous: previous === undefined ? undefined : toString(previous),
    }),
  )
}

describe('where a change stands in the newer document', () => {
  it('is the position of the block when it changed, with the block it was', () => {
    expect(
      stands(
        document('First block here.', 'alpha beta gamma delta', 'Last block here.'),
        document('First block here.', 'alpha beta gamma epsilon', 'Last block here.'),
      ),
    ).toEqual([{ change: 'changed', at: 1, previous: 'alpha beta gamma delta' }])
  })

  it('is the position of the block when it was added, with nothing before it', () => {
    expect(
      stands(document('First block here.'), document('First block here.', 'Second block here.')),
    ).toEqual([{ change: 'added', at: 1, previous: undefined }])
  })

  it('is the position of what followed it when it was removed, so it can be put back there', () => {
    expect(
      stands(
        document('One here.', 'Two here.', 'Three here.'),
        document('One here.', 'Three here.'),
      ),
    ).toEqual([{ change: 'removed', at: 1, previous: 'Two here.' }])
  })

  it('is the end of the document when what was removed was last', () => {
    expect(stands(document('One here.', 'Two here.'), document('One here.'))).toEqual([
      { change: 'removed', at: 1, previous: 'Two here.' },
    ])
  })

  it('counts the blocks of the document as written, presenter notes included', () => {
    const notes = ':::notes\nSay this first.\n:::'
    expect(
      stands(
        document(notes, 'One here.', 'Two here.'),
        document(notes, 'One here.', 'Two here.', 'Three here.'),
      ),
    ).toEqual([{ change: 'added', at: 3, previous: undefined }])
  })

  it('is that of the next block that is read, when presenter notes lie between', () => {
    const notes = ':::notes\nSay this first.\n:::'
    expect(
      stands(
        document('One here.', 'Two here.', notes, 'Three here.'),
        document('One here.', notes, 'Three here.'),
      ),
    ).toEqual([{ change: 'removed', at: 2, previous: 'Two here.' }])
  })
})
