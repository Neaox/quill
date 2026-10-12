import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import {
  DEPTH_CHOICES,
  TOC_LEVEL_CHOICES,
  depthLabel,
  levelLabel,
  withDepth,
  withTocMax,
  withTocMin,
} from './block-controls.ts'
import { documentHeadings, headingItems, sameHeadings } from './document-headings.ts'

const harness = createEditorTestHarness()

describe('the settings of the contents block', () => {
  it('offers every heading level', () => {
    expect(TOC_LEVEL_CHOICES).toEqual([1, 2, 3, 4, 5, 6])
    expect(levelLabel(3)).toBe('Heading 3')
  })

  it('changes one end and keeps every other attribute', () => {
    expect(withTocMin({ id: 'x', min: '2', max: '4' }, 3)).toEqual({ id: 'x', min: '3', max: '4' })
    expect(withTocMax({ id: 'x', min: '2', max: '4' }, 3)).toEqual({ id: 'x', min: '2', max: '3' })
  })

  it('drags the other end along rather than letting the range be empty', () => {
    expect(withTocMin({ min: '2', max: '3' }, 5)).toEqual({ min: '5', max: '5' })
    expect(withTocMax({ min: '2', max: '3' }, 1)).toEqual({ min: '1', max: '1' })
  })

  it('starts from the defaults when nothing is written', () => {
    expect(withTocMin({}, 4)).toEqual({ min: '4', max: '4' })
    expect(withTocMax({}, 6)).toEqual({ min: '2', max: '6' })
  })
})

describe('the settings of the child documents block', () => {
  it('offers one to five levels, named for how many', () => {
    expect(DEPTH_CHOICES).toEqual([1, 2, 3, 4, 5])
    expect(depthLabel(1)).toBe('1 level')
    expect(depthLabel(4)).toBe('4 levels')
  })

  it('sets the depth and keeps every other attribute', () => {
    expect(withDepth({ id: 'x' }, 3)).toEqual({ id: 'x', depth: '3' })
  })
})

describe('the headings of a document', () => {
  const doc = harness.state('# One\n\nText.\n\n## Two\n\n> ### Three, quoted\n').doc

  it('lists every heading in order, wherever it is', () => {
    expect(documentHeadings(doc).map(({ depth, text }) => [depth, text])).toEqual([
      [1, 'One'],
      [2, 'Two'],
      [3, 'Three, quoted'],
    ])
  })

  it('identifies each by its position, which is where the caret goes', () => {
    const [first, second] = documentHeadings(doc)
    expect(first?.id).toBe('0')
    expect(Number(second?.id)).toBeGreaterThan(0)
    expect(doc.nodeAt(Number(second?.id))?.textContent).toBe('Two')
  })

  it('answers the same document with the same list, without walking it again', () => {
    expect(documentHeadings(doc)).toBe(documentHeadings(doc))
  })

  it('is empty for a document with none', () => {
    expect(documentHeadings(harness.state('Just text.\n').doc)).toEqual([])
  })

  it('nests the headings between two levels for the list the block draws', () => {
    const items = headingItems(documentHeadings(doc), 2, 3)
    expect(items.map((item) => item.label)).toEqual(['Two'])
    expect(items[0]?.children?.map((item) => item.label)).toEqual(['Three, quoted'])
  })

  it('tells whether two lists of headings would draw the same contents', () => {
    const headings = documentHeadings(doc)
    expect(sameHeadings(headings, [...headings])).toBe(true)
    expect(sameHeadings(headings, null)).toBe(false)
    expect(sameHeadings(headings, headings.slice(1))).toBe(false)
    expect(
      sameHeadings(
        headings,
        headings.map((heading) => ({ ...heading, text: `${heading.text}!` })),
      ),
    ).toBe(false)
    expect(
      sameHeadings(
        headings,
        headings.map((heading) => ({ ...heading, depth: heading.depth + 1 })),
      ),
    ).toBe(false)
    expect(
      sameHeadings(
        headings,
        headings.map((heading) => ({ ...heading, id: `${heading.id}1` })),
      ),
    ).toBe(false)
  })
})
