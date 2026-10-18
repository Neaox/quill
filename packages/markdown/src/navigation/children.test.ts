import { describe, expect, it } from 'vitest'
import type { LeafDirective } from 'mdast-util-directive'

import { findDirective, validateDirectives } from '../directives/registry.ts'
import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import type { ChildPagesBlock } from './children.ts'
import {
  childPagesAttributes,
  childPagesFrom,
  childPagesSlotKey,
  childPagesSlots,
  childrenDirective,
  DEFAULT_CHILD_PAGES,
  parseChildPagesSlotKey,
} from './children.ts'

function leaf(source: string): LeafDirective {
  const found = parseMarkdown(source).children.find(
    (node): node is LeafDirective => node.type === 'leafDirective',
  )
  if (found === undefined) throw new Error(`no leaf directive in ${source}`)
  return found
}

describe('the child pages directive', () => {
  it('is registered, so a document is checked against it', () => {
    expect(findDirective(leaf('::children\n'))).toBe(childrenDirective)
  })

  it('reads its defaults from a bare ::children', () => {
    expect(childrenDirective.parse(leaf('::children\n'))).toEqual(DEFAULT_CHILD_PAGES)
    expect(DEFAULT_CHILD_PAGES).toEqual({
      title: undefined,
      depth: 1,
      sort: 'manual',
      excerpts: false,
      icons: false,
    })
  })

  it('reads every option an author can write', () => {
    expect(
      childrenDirective.parse(
        leaf('::children[In this section]{depth=3 sort=updated excerpts icons}\n'),
      ),
    ).toEqual({ title: 'In this section', depth: 3, sort: 'updated', excerpts: true, icons: true })
  })

  it('falls back to the defaults for what it cannot read, and says so', () => {
    const source = '::children{depth=9 sort=random}\n'
    expect(childrenDirective.parse(leaf(source))).toMatchObject({ depth: 1, sort: 'manual' })
    expect(validateDirectives(parseMarkdown(source))).toEqual([
      {
        path: 'children[0].depth',
        message: 'Depth "9" is not a whole number from 1 to 6; one level is listed.',
        severity: 'warning',
      },
      {
        path: 'children[0].sort',
        message: 'Unknown sort "random"; pages are listed in the navigation’s order.',
        severity: 'warning',
      },
    ])
    expect(validateDirectives(parseMarkdown('::children{depth=6 sort=title}\n'))).toEqual([])
  })

  it.each(['0', '1.5', 'two', ''])('refuses the depth %j', (depth) => {
    expect(childrenDirective.parse(leaf(`::children{depth="${depth}"}\n`)).depth).toBe(1)
  })

  it('writes a model back with only what differs from the defaults, and round-trips it', () => {
    const model: ChildPagesBlock = {
      title: 'Guides',
      depth: 2,
      sort: 'title',
      excerpts: true,
      icons: false,
    }
    const written = stringifyMdast({ type: 'root', children: [childrenDirective.serialize(model)] })
    expect(written).toBe('::children[Guides]{depth="2" sort="title" excerpts}\n')
    expect(childrenDirective.parse(leaf(written))).toEqual(model)
    expect(
      stringifyMdast({
        type: 'root',
        children: [childrenDirective.serialize(DEFAULT_CHILD_PAGES)],
      }),
    ).toBe('::children\n')
  })

  it('keeps attributes it does not own (rule 7)', () => {
    expect(
      childPagesAttributes({ depth: '3', layout: 'grid', icons: '' }, { ...DEFAULT_CHILD_PAGES }),
    ).toEqual({ layout: 'grid' })
    expect(childPagesAttributes(undefined, { ...DEFAULT_CHILD_PAGES, icons: true })).toEqual({
      icons: '',
    })
  })
})

describe('the slot key', () => {
  it('names the block by its options, in a fixed order', () => {
    expect(childPagesSlotKey(DEFAULT_CHILD_PAGES)).toBe('children?depth=1&sort=manual')
    expect(childPagesSlotKey({ depth: 4, sort: 'updated', excerpts: true, icons: true })).toBe(
      'children?depth=4&sort=updated&excerpts&icons',
    )
  })

  it('reads back to the options it names, without the title', () => {
    const model: ChildPagesBlock = {
      title: undefined,
      depth: 2,
      sort: 'title',
      excerpts: false,
      icons: true,
    }
    expect(parseChildPagesSlotKey(childPagesSlotKey(model))).toEqual({
      depth: 2,
      sort: 'title',
      excerpts: false,
      icons: true,
    })
  })

  it.each([
    '',
    'toc?depth=1',
    'children?depth=9&sort=manual',
    'children?depth=1&sort=nope',
    'children',
  ])('refuses %j', (key) => {
    expect(parseChildPagesSlotKey(key)).toBeUndefined()
  })
})

describe('childPagesSlots', () => {
  it('lists each slot key a body carries once, leaving presenter notes out', () => {
    const tree = parseMarkdown(
      '::children\n\n::children[Again]\n\n::children{depth=2}\n\n:::notes\n::children{depth=3}\n:::\n\n::toc\n',
    )
    expect(childPagesSlots(tree)).toEqual([
      'children?depth=1&sort=manual',
      'children?depth=2&sort=manual',
    ])
  })
})

describe('childPagesFrom', () => {
  it('reads the parts the editor holds with the same parser', () => {
    expect(childPagesFrom({ depth: '3', icons: '' }, 'Guides')).toEqual({
      title: 'Guides',
      depth: 3,
      sort: 'manual',
      excerpts: false,
      icons: true,
    })
    expect(childPagesFrom(undefined, '')).toEqual(DEFAULT_CHILD_PAGES)
  })
})

describe('attributes written with no value', () => {
  it('are kept as bare attributes', () => {
    expect(childPagesAttributes({ future: null, depth: null }, DEFAULT_CHILD_PAGES)).toEqual({
      future: '',
    })
  })
})
