import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import type { List, Paragraph, Root, RootContent, Table } from 'mdast'
import type { ContainerDirective, TextDirective } from 'mdast-util-directive'

import { mdastToProseMirror } from '../prosemirror/from-mdast.ts'
import { liftLayout, wrapLayout } from '../prosemirror/layout.ts'
import { proseMirrorToMdast } from '../prosemirror/to-mdast.ts'
import { parseDocument } from './parse-document.ts'
import { parseMarkdown, stringifyMdast } from './processor.ts'
import { serializeDocument } from './serialize-document.ts'
import { markSourceForm, sourceFormToMarkdown } from './source-form.ts'
import { remarkToMarkdownExtensions } from './to-markdown-extensions.ts'

/**
 * How a node was written comes back as it was (ADR-002, ADR-003 requirement 5),
 * for as long as it still describes the node, and the canonical form takes over
 * the moment it does not.
 */

/** Byte offsets are not semantics, nor is how a node was spelled. */
function semantics(tree: Root): string {
  return JSON.stringify(tree, (key, value: unknown) => {
    if (key === 'position' || value === null) return undefined
    if (key !== 'data' || typeof value !== 'object') return value
    const rest = Object.entries(value).filter(([name]) => name !== 'sourceForm')
    return rest.length === 0 ? undefined : Object.fromEntries(rest)
  })
}

/** Read and written back, without the editor. */
function rewritten(markdown: string): string {
  return stringifyMdast(parseMarkdown(markdown))
}

/** Through the editor's schema and back, layout lifted and wrapped, as a save does. */
function saved(markdown: string): string {
  const parsed = parseDocument(markdown)
  const { doc } = mdastToProseMirror(parsed.ast)
  return serializeDocument({
    frontMatter: parsed.frontMatter,
    ast: proseMirrorToMdast(wrapLayout(liftLayout(doc))).tree,
  })
}

/** Reads `markdown`, changes the tree with `edit`, writes it, and checks it reads back as edited. */
function edited(markdown: string, edit: (tree: Root) => void): string {
  const tree = parseMarkdown(markdown)
  edit(tree)
  const written = stringifyMdast(tree)
  expect(semantics(parseMarkdown(written))).toBe(semantics(tree))
  return written
}

function first<T extends RootContent['type']>(
  tree: Root,
  type: T,
): Extract<RootContent, { type: T }> {
  const found = tree.children.find(
    (child): child is Extract<RootContent, { type: T }> => child.type === type,
  )
  if (found === undefined) throw new Error(`no ${type}`)
  return found
}

const KEPT = [
  ['an underscore emphasis', 'A night is _held_ by one site.'],
  ['an underscore strong emphasis', 'A night is __held__ by one site.'],
  ['a hard break written with spaces', 'One line,  \nand the next.'],
  ['a hard break written with three spaces', 'One line,   \nand the next.'],
  ['a delimiter row without spaces', '| a | b |\n|---|---|\n| 1 | 2 |'],
  ['a delimiter row with alignment', '| a | b | c |\n|:---|:---:|---:|\n| 1 | 2 | 3 |'],
  ['a delimiter row without outer pipes', 'a | b\n--- | ---\n1 | 2'],
  ['an aligned table', '| Region | Budget |\n| ------ | -----: |\n| eu     |    120 |'],
  ['a row shorter than its header', '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |'],
  ['a table in a quote', '> | a |\n> |---|\n> | 1 |'],
  ['unquoted attributes', ':::callout{type=warning}\nBody.\n:::'],
  ['an id written as an attribute', ':::decision{id=D9 status=accepted}\nBody.\n:::'],
  ['a labelled container', ':::callout[Before you begin]{type=note}\nBody.\n:::'],
  ['a text directive', 'Status: :badge[Built]{tone=success} today.'],
  ['a text directive with an escaped label', 'Status: :badge[a \\] b]{tone=success} today.'],
  ['a leaf directive', '::toc{depth=3}'],
  ['a quoted value holding a brace', ':badge[x]{title="a } b" tone=ok}'],
  ['a padded container', ':::figure\n\nA paragraph.\n\n:::'],
  ['a padded wide wrapper', ':::wide\n\n| a |\n|---|\n| 1 |\n\n:::'],
  ['a list straight after its paragraph', 'Three things:\n- one\n- two'],
  ['an ordered list straight after its paragraph', 'Three things:\n1. one\n2. two'],
  ['a table straight after its paragraph', 'The costs:\n| a |\n|---|\n| 1 |'],
  ['a fence straight after its paragraph', 'Run:\n```sh\nls\n```'],
  ['a heading straight after a list', '- one\n# Next'],
  ['a rule straight after a list', '- one\n---'],
  ['a quote straight after a paragraph', 'Said:\n> quoted'],
  ['a paragraph straight after a heading', '# Title\nThe words.'],
  ['two blank lines', 'One.\n\n\nTwo.'],
  ['a loose list with tight items', '- a\n- b\n\n  more\n- c'],
  ['a loose list with mixed boundaries', '- a\n- b\n\n- c'],
  ['a loose list with extra blank lines', '- a\n\n\n- b'],
  ['an ordered list out of order', '1. one\n3. two\n2. three'],
  ['an ordered list from ten', '10. ten\n12. eleven'],
  ['blank lines inside a container', ':::callout\nOne.\n\n\nTwo.\n:::'],
]

describe('a node written as it was', () => {
  it.each(KEPT)('keeps %s', (_name, markdown) => {
    const source = `${markdown}\n`
    expect(rewritten(source)).toBe(source)
    expect(saved(source)).toBe(source)
  })
})

describe('a node that has changed', () => {
  it('writes emphasis with `*` where a letter now touches an underscore', () => {
    const written = edited('A _held_ night.\n', (tree) => {
      const [text] = first(tree, 'paragraph').children
      if (text?.type === 'text') text.value = 'Un'
    })
    expect(written).toBe('Un*held* night.\n')
  })

  it('writes a hard break as a backslash where spaces cannot go', () => {
    // A break in a table cell is written as a space by the library; the spaces
    // recorded for it describe a line ending there is not.
    const tree = parseMarkdown('A  \nB\n')
    const paragraph = first(tree, 'paragraph')
    const table: Table = {
      type: 'table',
      align: [null],
      children: [
        {
          type: 'tableRow',
          children: [{ type: 'tableCell', children: [{ type: 'text', value: 'h' }] }],
        },
        { type: 'tableRow', children: [{ type: 'tableCell', children: paragraph.children }] },
      ],
    }
    expect(stringifyMdast({ type: 'root', children: [table] })).toBe('| h |\n| - |\n| A B |\n')
  })

  it('writes a changed row canonically and keeps the others', () => {
    const written = edited('| a  | b |\n|---|---|\n| 1  | 2 |\n| 3  | 4 |\n', (tree) => {
      const [, row] = first(tree, 'table').children
      const [cell] = row?.children ?? []
      if (cell !== undefined) cell.children = [{ type: 'text', value: '9' }]
    })
    expect(written).toBe('| a  | b |\n|---|---|\n| 9 | 2 |\n| 3  | 4 |\n')
  })

  it('writes the whole table canonically once a column is added or realigned', () => {
    const added = edited('| a |\n|---|\n| 1 |\n', (tree) => {
      const table = first(tree, 'table')
      table.align = [null, null]
      for (const row of table.children) row.children.push({ type: 'tableCell', children: [] })
    })
    expect(added).toBe('| a | |\n| - | - |\n| 1 | |\n')

    const realigned = edited('| a |\n|---|\n| 1 |\n', (tree) => {
      first(tree, 'table').align = ['right']
    })
    expect(realigned).toBe('| a |\n| -: |\n| 1 |\n')
  })

  it('writes a table the editor made canonically', () => {
    const table: Table = {
      type: 'table',
      children: [{ type: 'tableRow', children: [{ type: 'tableCell', children: [] }] }],
      data: { sourceForm: { delimiterRow: 'not a delimiter row' } },
    }
    expect(stringifyMdast({ type: 'root', children: [table] })).toBe('| |\n| - |\n')
  })

  it('writes changed attributes canonically', () => {
    const written = edited(':::callout{type=warning}\nBody.\n:::\n', (tree) => {
      first(tree, 'containerDirective').attributes = { type: 'note' }
    })
    expect(written).toBe(':::callout{type="note"}\nBody.\n:::\n')
  })

  it('keeps the attributes of a text directive whose words changed', () => {
    const written = edited('A :badge[Built]{tone=success}.\n', (tree) => {
      const [, badge] = first(tree, 'paragraph').children
      if (badge?.type === 'textDirective') badge.children = [{ type: 'text', value: 'Done' }]
    })
    expect(written).toBe('A :badge[Done]{tone=success}.\n')
  })

  it('records attributes only where they read back as the node’s own', () => {
    const source = String.raw`:badge[a [b] \] c]{tone=x} and :x{a="b}"}` + '\n'
    const tree = parseMarkdown(source)
    const directives = first(tree, 'paragraph').children.filter(
      (child) => child.type === 'textDirective',
    )
    expect(directives.map((node) => node.data?.sourceForm?.attributes?.written)).toEqual([
      '{tone=x}',
      '{a="b}"}',
    ])

    for (const node of directives) node.data = {}
    markSourceForm(tree, source, () => undefined)
    expect(directives.map((node) => node.data?.sourceForm?.attributes)).toEqual([
      undefined,
      undefined,
    ])
  })

  it('reads a container with nothing in it and pads nothing', () => {
    expect(rewritten(':::callout{type=note}\n:::\n')).toBe(':::callout{type=note}\n:::\n')
  })

  it('pads a padded container whose body was emptied as nothing', () => {
    const written = edited(':::figure\n\nA paragraph.\n\n:::\n', (tree) => {
      first(tree, 'containerDirective').children = []
    })
    expect(written).toBe(':::figure\n:::\n')
  })

  it('numbers an ordered list canonically once an item is added', () => {
    const written = edited('1. one\n3. two\n', (tree) => {
      const list = first(tree, 'list')
      list.children.push({
        type: 'listItem',
        spread: false,
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'three' }] }],
      })
    })
    expect(written).toBe('1. one\n2. two\n3. three\n')
  })

  it('writes a list item the editor put at the top level', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'listItem',
          spread: false,
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'loose' }] }],
        },
      ] as RootContent[],
    }
    expect(stringifyMdast(tree)).toBe('- loose\n')
  })

  it.each([
    [
      'a list whose first item is empty',
      'Three things:\n- one\n',
      (list: List) => {
        const [item] = list.children
        if (item !== undefined) item.children = []
      },
      'Three things:\n\n-\n',
    ],
    [
      'an ordered list that no longer starts at one',
      'Steps:\n1. one\n',
      (list: List) => {
        list.start = 3
      },
      'Steps:\n\n3. one\n',
    ],
  ])('separates %s from the paragraph before it', (_name, markdown, edit, expected) => {
    expect(edited(markdown, (tree) => edit(first(tree, 'list')))).toBe(expected)
  })

  it.each([
    ['a paragraph after a list', '- one\n# Next\n', 'Then.'],
    ['a rule after a paragraph', 'Words.\n# Next\n', '---'],
    ['a quote after a quote', '> one\n# Next\n', '> two'],
    ['a paragraph after a table', '| a |\n|---|\n# Next\n', 'Then.'],
  ])('keeps a blank line before %s', (_name, markdown, replacement) => {
    // The heading recorded as written straight after the block before it is
    // replaced by a block that would be read into that block without one.
    const written = edited(markdown, (tree) => {
      const [, heading] = tree.children
      const replaced = parseMarkdown(`${replacement}\n`).children[0]
      if (heading !== undefined && replaced !== undefined) {
        replaced.data = { ...replaced.data, sourceForm: heading.data?.sourceForm }
        tree.children[1] = replaced
      }
    })
    expect(written).toContain(`\n\n${replacement}`)
  })

  it('keeps a loose list loose once the boundary that made it loose is gone', () => {
    const written = edited('- a\n- b\n\n- c\n', (tree) => {
      const list = first(tree, 'list')
      list.children = list.children.slice(0, 2)
    })
    expect(written).toBe('- a\n\n- b\n')
  })

  it('keeps a tight item tight in a tight list', () => {
    const written = edited('- a\n- b\n', (tree) => {
      const [, item] = first(tree, 'list').children
      if (item !== undefined) item.data = { sourceForm: { blankLines: 2 } }
    })
    expect(written).toBe('- a\n- b\n')
  })

  it('writes the blocks of a tight item apart once it holds two paragraphs', () => {
    const tree = parseMarkdown('- a\n  b\n')
    const [item] = first(tree, 'list').children
    const paragraph: Paragraph = {
      type: 'paragraph',
      children: [{ type: 'text', value: 'c' }],
      data: { sourceForm: { blankLines: 0 } },
    }
    item?.children.push(paragraph)
    expect(stringifyMdast(tree)).toBe('- a\n  b\n\n  c\n')
  })

  it('writes what the editor made without a recorded form', () => {
    const directive: TextDirective = { type: 'textDirective', name: 'badge', children: [] }
    const container: ContainerDirective = {
      type: 'containerDirective',
      name: 'note',
      children: [],
      data: { sourceForm: { padded: true } },
    }
    const tree: Root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [directive] }, container],
    }
    expect(stringifyMdast(tree)).toBe(':badge\n\n:::note\n:::\n')
  })

  it('writes a directive whose attributes the editor took away canonically', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'leafDirective',
          name: 'toc',
          children: [],
          data: { sourceForm: { attributes: { written: '{depth=3}', read: '{"depth":"3"}' } } },
        },
      ],
    }
    expect(stringifyMdast(tree)).toBe('::toc\n')
  })

  it('reads an attribute block the parser does not as no recorded form', () => {
    const tree = parseMarkdown(':badge[x]{=}\n')
    const [badge] = first(tree, 'paragraph').children
    expect(badge?.data?.sourceForm?.attributes).toBeUndefined()
  })

  it('separates a list with no items from the paragraph before it', () => {
    const tree: Root = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Words.' }] },
        { type: 'list', children: [], data: { sourceForm: { blankLines: 0 } } },
      ],
    }
    expect(stringifyMdast(tree)).toBe('Words.\n\n')
  })

  it('records nothing for nodes the parser did not place', () => {
    const tree: Root = {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'a' }] },
        { type: 'paragraph', children: [{ type: 'text', value: 'b' }] },
      ],
    }
    markSourceForm(tree, 'a\n\nb\n', () => undefined)
    expect(semantics(tree)).toBe(semantics(parseMarkdown('a\n\nb\n')))

    // A list and a table the parser placed, holding items and rows it did not.
    const placed = parseMarkdown('1. a\n3. b\n\n| h |\n|---|\n| 1 |\n')
    for (const node of placed.children) {
      if (node.type === 'list') for (const item of node.children) delete item.position
      if (node.type === 'table') for (const row of node.children) delete row.position
      node.data = {}
    }
    const empty: Table = { type: 'table', children: [], position: placed.position }
    markSourceForm({ ...placed, children: [...placed.children, empty] }, 'x', () => undefined)
    expect(placed.children.map((node) => node.data?.sourceForm)).toEqual([
      { numbers: [Number.NaN, Number.NaN] },
      undefined,
    ])
  })

  it('records no attributes behind a label it cannot find the end of', () => {
    const source = ':badge[open {tone=x}'
    const badge: TextDirective = {
      type: 'textDirective',
      name: 'badge',
      attributes: { tone: 'x' },
      children: [],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 21, offset: 20 },
      },
    }
    const tree: Root = { type: 'root', children: [{ type: 'paragraph', children: [badge] }] }
    markSourceForm(tree, source, () => '{"tone":"x"}')
    expect(badge.data?.sourceForm).toBeUndefined()
  })

  it('peeks at emphasis with the writer’s own marker when none was recorded', () => {
    const bare = unified().use(remarkToMarkdownExtensions).use(remarkStringify).freeze()
    expect(bare.stringify(parseMarkdown('a *b*\n'))).toBe('a *b*\n')
  })

  it('needs no handlers it has nothing to wrap', () => {
    expect(Object.keys(sourceFormToMarkdown({}).handlers ?? {})).toEqual([
      'emphasis',
      'strong',
      'break',
      'listItem',
    ])
  })
})
