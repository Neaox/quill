import { describe, expect, it } from 'vitest'

import { summariseDraft } from './draft-summary.ts'

const text = (value: string) => ({ type: 'text', value })
const heading = (depth: number, value: string) => ({
  type: 'heading',
  depth,
  children: [text(value)],
})
const paragraph = (value: string) => ({ type: 'paragraph', children: [text(value)] })
const root = (...children: readonly object[]) => ({ type: 'root', children })

describe('what a draft holds, in the words a person would use', () => {
  it('counts the sections and the words written under them', () => {
    const tree = root(
      heading(1, 'Runbook'),
      heading(2, 'Overview'),
      paragraph('Three tiers and a cache in front.'),
      heading(2, 'Steps'),
      {
        type: 'list',
        children: [{ type: 'listItem', children: [paragraph('Fail over the primary')] }],
      },
    )

    expect(summariseDraft(tree)).toEqual({ sections: 2, words: 11 })
  })

  it('does not count the words of headings, which are the sections, nor of a template’s guidance, which is not writing', () => {
    const tree = root(
      heading(2, 'Context'),
      {
        type: 'containerDirective',
        name: 'guidance',
        children: [paragraph('Explain why this decision is needed in two or three sentences.')],
      },
      heading(2, 'Decision'),
      paragraph(''),
    )

    expect(summariseDraft(tree)).toEqual({ sections: 2, words: 0 })
  })

  it('counts words in a block that holds blocks, such as a callout or a table, and in nested formatting', () => {
    const tree = root({
      type: 'containerDirective',
      name: 'callout',
      children: [
        { type: 'paragraph', children: [{ type: 'strong', children: [text('Careful here')] }] },
      ],
    })

    expect(summariseDraft(tree)).toEqual({ sections: 0, words: 2 })
  })

  it('says nothing for a tree it cannot read, rather than guessing', () => {
    expect(summariseDraft(undefined)).toBeUndefined()
    expect(summariseDraft({ type: 'paragraph' })).toBeUndefined()
  })
})
