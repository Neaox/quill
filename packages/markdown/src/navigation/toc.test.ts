import { describe, expect, it } from 'vitest'
import type { LeafDirective } from 'mdast-util-directive'

import { findDirective, validateDirectives } from '../directives/registry.ts'
import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { extractOutline } from '../render/outline.ts'
import type { TableOfContents } from './toc.ts'
import {
  DEFAULT_TABLE_OF_CONTENTS,
  formatLevels,
  parseLevels,
  tableOfContentsAttributes,
  tableOfContentsEntries,
  tableOfContentsFrom,
  tocDirective,
} from './toc.ts'

function leaf(source: string): LeafDirective {
  const found = parseMarkdown(source).children.find(
    (node): node is LeafDirective => node.type === 'leafDirective',
  )
  if (found === undefined) throw new Error(`no leaf directive in ${source}`)
  return found
}

describe('the table of contents directive', () => {
  it('is registered, so a document is checked against it', () => {
    expect(findDirective(leaf('::toc\n'))).toBe(tocDirective)
  })

  it('reads its defaults from a bare ::toc', () => {
    expect(tocDirective.parse(leaf('::toc\n'))).toEqual(DEFAULT_TABLE_OF_CONTENTS)
    expect(DEFAULT_TABLE_OF_CONTENTS).toEqual({
      title: undefined,
      levels: { from: 2, to: 3 },
      style: 'bulleted',
      collapsed: false,
    })
  })

  it('reads every option an author can write', () => {
    expect(
      tocDirective.parse(leaf('::toc[On this page]{levels=1-4 style=numbered collapsed}\n')),
    ).toEqual({
      title: 'On this page',
      levels: { from: 1, to: 4 },
      style: 'numbered',
      collapsed: true,
    })
  })

  it('treats collapsed=false as not collapsed, and a blank title as none', () => {
    expect(tocDirective.parse(leaf('::toc[  ]{collapsed=false}\n'))).toMatchObject({
      title: undefined,
      collapsed: false,
    })
  })

  it('falls back to the defaults for what it cannot read, and says so', () => {
    const node = leaf('::toc{levels=9 style=roman}\n')
    expect(tocDirective.parse(node)).toMatchObject({
      levels: { from: 2, to: 3 },
      style: 'bulleted',
    })
    expect(validateDirectives(parseMarkdown('::toc{levels=9 style=roman}\n'))).toEqual([
      {
        path: 'toc[0].levels',
        message: 'Heading levels "9" are not a range from 1 to 6; levels 2-3 are listed.',
        severity: 'warning',
      },
      {
        path: 'toc[0].style',
        message: 'Unknown style "roman"; the list is bulleted.',
        severity: 'warning',
      },
    ])
    expect(validateDirectives(parseMarkdown('::toc{levels=2-4 style=numbered}\n'))).toEqual([])
  })

  it('writes a model back with only what differs from the defaults', () => {
    const model: TableOfContents = {
      title: 'Contents',
      levels: { from: 2, to: 4 },
      style: 'numbered',
      collapsed: true,
    }
    expect(stringifyMdast({ type: 'root', children: [tocDirective.serialize(model)] })).toBe(
      '::toc[Contents]{levels="2-4" style="numbered" collapsed}\n',
    )
    expect(
      stringifyMdast({
        type: 'root',
        children: [tocDirective.serialize(DEFAULT_TABLE_OF_CONTENTS)],
      }),
    ).toBe('::toc\n')
  })

  it('round-trips what it writes', () => {
    const model: TableOfContents = {
      title: undefined,
      levels: { from: 3, to: 3 },
      style: 'bulleted',
      collapsed: false,
    }
    const written = stringifyMdast({ type: 'root', children: [tocDirective.serialize(model)] })
    expect(written).toBe('::toc{levels="3"}\n')
    expect(tocDirective.parse(leaf(written))).toEqual(model)
  })
})

describe('tableOfContentsAttributes', () => {
  it('sets the options it owns and keeps every attribute it does not know (rule 7)', () => {
    expect(
      tableOfContentsAttributes(
        { levels: '2-3', theme: 'compact', collapsed: '' },
        { title: undefined, levels: { from: 1, to: 2 }, style: 'numbered', collapsed: false },
      ),
    ).toEqual({ levels: '1-2', theme: 'compact', style: 'numbered' })
  })

  it('accepts no attributes at all', () => {
    expect(tableOfContentsAttributes(undefined, DEFAULT_TABLE_OF_CONTENTS)).toEqual({})
  })
})

describe('heading level ranges', () => {
  it.each([
    ['2-3', { from: 2, to: 3 }],
    ['1-6', { from: 1, to: 6 }],
    ['4', { from: 4, to: 4 }],
    [' 3 - 5 ', { from: 3, to: 5 }],
    ['5-2', { from: 2, to: 5 }],
  ])('reads %j', (value, expected) => {
    expect(parseLevels(value)).toEqual(expected)
  })

  it.each(['', '0-2', '2-7', 'two', '1-2-3', '2.5'])('refuses %j', (value) => {
    expect(parseLevels(value)).toBeUndefined()
  })

  it('writes a range as short as it reads', () => {
    expect(formatLevels({ from: 2, to: 3 })).toBe('2-3')
    expect(formatLevels({ from: 4, to: 4 })).toBe('4')
  })
})

describe('tableOfContentsEntries', () => {
  const outline = extractOutline(
    parseMarkdown(
      [
        '# Title',
        '## Install',
        '### Linux',
        '#### Debian',
        '### macOS',
        '## Setup',
        '## Setup',
        '#### Deep under setup',
        '## Use',
        '',
      ].join('\n\n'),
    ),
  )

  it('lists levels 2 and 3 by default, nested as the headings are', () => {
    expect(tableOfContentsEntries(outline, { from: 2, to: 3 })).toEqual([
      {
        id: 'user-content-install',
        text: 'Install',
        depth: 2,
        children: [
          { id: 'user-content-linux', text: 'Linux', depth: 3, children: [] },
          { id: 'user-content-macos', text: 'macOS', depth: 3, children: [] },
        ],
      },
      { id: 'user-content-setup', text: 'Setup', depth: 2, children: [] },
      // A repeated heading keeps the numbered id its own permalink has.
      { id: 'user-content-setup-1', text: 'Setup', depth: 2, children: [] },
      { id: 'user-content-use', text: 'Use', depth: 2, children: [] },
    ])
  })

  it('nests a level that skips one under the nearest shallower entry', () => {
    const entries = tableOfContentsEntries(outline, { from: 2, to: 4 })
    expect(entries[2]).toEqual({
      id: 'user-content-setup-1',
      text: 'Setup',
      depth: 2,
      children: [
        { id: 'user-content-deep-under-setup', text: 'Deep under setup', depth: 4, children: [] },
      ],
    })
  })

  it('lifts entries whose parent level is not listed', () => {
    expect(tableOfContentsEntries(outline, { from: 3, to: 3 }).map((entry) => entry.text)).toEqual([
      'Linux',
      'macOS',
    ])
  })

  it('can include the title', () => {
    const [title] = tableOfContentsEntries(outline, { from: 1, to: 1 })
    expect(title).toEqual({ id: 'user-content-title', text: 'Title', depth: 1, children: [] })
  })

  it('lists nothing for a document without headings at those levels', () => {
    expect(tableOfContentsEntries(outline, { from: 5, to: 6 })).toEqual([])
  })
})

describe('tableOfContentsFrom', () => {
  it('reads the parts the editor holds with the same parser', () => {
    expect(tableOfContentsFrom({ levels: '1-2', collapsed: '' }, 'Contents')).toEqual({
      title: 'Contents',
      levels: { from: 1, to: 2 },
      style: 'bulleted',
      collapsed: true,
    })
    expect(tableOfContentsFrom(null, '')).toEqual(DEFAULT_TABLE_OF_CONTENTS)
  })
})

describe('attributes written with no value', () => {
  it('are kept as bare attributes', () => {
    expect(tableOfContentsAttributes({ future: undefined }, DEFAULT_TABLE_OF_CONTENTS)).toEqual({
      future: '',
    })
  })
})
