import type { Blockquote, PhrasingContent, Root } from 'mdast'
import { describe, expect, it } from 'vitest'

import { alertOpening, markerOf } from './github-alert.ts'
import { stringifyMdast } from './processor.ts'

const text = (value: string): PhrasingContent => ({ type: 'text', value })

const quote = (...inline: PhrasingContent[]): Blockquote => ({
  type: 'blockquote',
  children: [{ type: 'paragraph', children: inline }],
})

describe('the marker an alert made in the editor is written with', () => {
  it('is GitHub’s capitals for the kinds GitHub has, and Obsidian’s lower case for the rest', () => {
    expect(markerOf('note')).toBe('[!NOTE]')
    expect(markerOf('caution')).toBe('[!CAUTION]')
    expect(markerOf('info')).toBe('[!info]')
  })
})

describe('the title of an alert', () => {
  it('drops the spaces its line ends on, and the text they leave empty', () => {
    const opening = alertOpening(
      quote(text('[!tip] '), { type: 'emphasis', children: [text('Title')] }, text('   ')),
    )

    expect(opening?.title).toEqual([{ type: 'emphasis', children: [text('Title')] }])
  })
})

describe('writing the marker of an alert whose first line is in several pieces', () => {
  const written = (...inline: PhrasingContent[]): string =>
    stringifyMdast({ type: 'root', children: [quote(...inline)] } satisfies Root)

  it('keeps a space between the marker and words that follow it in a text of their own', () => {
    expect(written(text('[!NOTE]'), text('Body.'))).toBe('> [!NOTE] Body.\n')
  })

  it('leaves the line break between the marker and a text that starts on the next line', () => {
    expect(written(text('[!NOTE]'), text('\nBody.'))).toBe('> [!NOTE]\n> Body.\n')
  })
})
