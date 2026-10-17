import { describe, expect, it } from 'vitest'
import type { ComparedChange, ComparedContent } from '@quill/application'

import { comparisonResponse } from './document-schemas.ts'

const AT = '2026-01-01T00:00:00.000Z'

const SUMMARY = {
  sections: 1,
  added: 1,
  removed: 0,
  changed: 0,
  moved: 0,
  wordsAdded: 2,
  wordsRemoved: 0,
} as const

const BARE_CHANGE: ComparedChange = {
  id: 'c1',
  change: 'added',
  block: 'paragraph',
  excerpt: 'Hello',
  wordsAdded: 2,
  wordsRemoved: 0,
}

function content(
  changes: readonly ComparedChange[],
  properties: ComparedContent['properties'] = [],
): ComparedContent {
  return { version: 2, html: '<p>Hello</p>', sections: [], changes, summary: SUMMARY, properties }
}

describe('comparisonResponse', () => {
  it('leaves out what a change does not carry rather than answering it as undefined', () => {
    const [change] = comparisonResponse(content([BARE_CHANGE])).changes

    expect(change).toStrictEqual({
      id: 'c1',
      change: 'added',
      block: 'paragraph',
      excerpt: 'Hello',
      wordsAdded: 2,
      wordsRemoved: 0,
    })
  })

  it('carries a change’s section, drawing, revertibility and author when it has them', () => {
    const [change] = comparisonResponse(
      content([
        {
          ...BARE_CHANGE,
          section: { id: 'intro', title: 'Intro' },
          html: '<ins>Hello</ins>',
          revertible: false,
          author: { userId: 'u1', at: AT, name: 'Ada' },
        },
      ]),
    ).changes

    expect(change).toMatchObject({
      section: { id: 'intro', title: 'Intro' },
      html: '<ins>Hello</ins>',
      revertible: false,
      author: { id: 'u1', at: AT, name: 'Ada' },
    })
  })

  it('names no author whose account is gone', () => {
    const [change] = comparisonResponse(
      content([{ ...BARE_CHANGE, author: { userId: 'u1', at: AT } }]),
    ).changes

    expect(change?.author).toStrictEqual({ id: 'u1', at: AT })
  })

  it('says only the side of a changed property that exists', () => {
    const { properties } = comparisonResponse(
      content(
        [],
        [
          { name: 'status', before: 'draft', after: 'published' },
          { name: 'owner', after: 'Ada' },
          { name: 'reviewer', before: 'Grace' },
        ],
      ),
    )

    expect(properties).toStrictEqual([
      { name: 'status', before: 'draft', after: 'published' },
      { name: 'owner', after: 'Ada' },
      { name: 'reviewer', before: 'Grace' },
    ])
  })
})
