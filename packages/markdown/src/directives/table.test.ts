import { describe, expect, it } from 'vitest'
import type { ContainerDirective } from 'mdast-util-directive'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { findDirective, validateDirectives } from './registry.ts'
import {
  columnPercentages,
  DEFAULT_TABLE_OPTIONS,
  readTableOptions,
  renderedPercent,
  tableDirective,
  tableOf,
} from './table.ts'

const TABLE = '| Region | Owner | Budget |\n| - | - | -: |\n| eu | Platform | 120 |\n'

function container(attributes: string, body = TABLE): ContainerDirective {
  const found = parseMarkdown(`:::table${attributes}\n${body}:::\n`).children.find(
    (node): node is ContainerDirective => node.type === 'containerDirective',
  )
  if (found === undefined) throw new Error(`no container directive for ${attributes}`)
  return found
}

function write(node: ContainerDirective): string {
  return stringifyMdast({ type: 'root', children: [node] })
}

describe('the table directive', () => {
  it('is registered, so a document is checked against it', () => {
    expect(findDirective(container(''))).toBe(tableDirective)
  })

  it('reads every option an author can write', () => {
    const model = tableDirective.parse(
      container(
        '{width=55% columns="2fr 3fr 1fr" freeze=header,first-column responsive=stack sort=off}',
      ),
    )

    expect(model).toMatchObject({
      width: { percent: 55 },
      columns: [2, 3, 1],
      freeze: ['header', 'first-column'],
      responsive: 'stack',
      sortable: false,
      other: {},
    })
    expect(tableOf(container(''))?.type).toBe('table')
  })

  it('has the defaults of a table written without it', () => {
    expect(tableDirective.parse(container(''))).toMatchObject(DEFAULT_TABLE_OPTIONS)
    expect(DEFAULT_TABLE_OPTIONS).toEqual({
      width: undefined,
      columns: undefined,
      headers: 'column',
      footer: 0,
      freeze: 'auto',
      responsive: 'scroll',
      sortable: true,
      captionSide: 'top',
    })
  })

  it('reads the three named widths', () => {
    for (const width of ['content', 'wide', 'full'] as const) {
      expect(tableDirective.parse(container(`{width=${width}}`)).width).toBe(width)
    }
  })

  it('reads bare numbers as proportions too', () => {
    expect(tableDirective.parse(container('{columns="1 1.5 2fr"}')).columns).toEqual([1, 1.5, 2])
  })

  it('reads freeze=none as nothing frozen, which is not the automatic default', () => {
    expect(tableDirective.parse(container('{freeze=none}')).freeze).toEqual([])
  })

  it('keeps an attribute it does not understand, and one whose value it cannot read', () => {
    const node = container('{width=huge caption="Regions" sort=off}')
    const model = tableDirective.parse(node)

    expect(model.width).toBeUndefined()
    expect(model.other).toEqual({ width: 'huge', caption: 'Regions' })
    expect(write(tableDirective.serialize(model))).toBe(
      `:::table{sort="off" width="huge" caption="Regions"}\n${TABLE}:::\n`,
    )
  })

  it('writes back what it read, in one canonical order, leaving defaults unwritten', () => {
    const node = container(
      '{sort=off responsive=stack freeze=first-column columns="2fr 3fr 1fr" width=full}',
    )

    expect(write(tableDirective.serialize(tableDirective.parse(node)))).toBe(
      `:::table{width="full" columns="2fr 3fr 1fr" freeze="first-column" responsive="stack" sort="off"}\n${TABLE}:::\n`,
    )
    expect(
      write(tableDirective.serialize(tableDirective.parse(container('{responsive=scroll}')))),
    ).toBe(`:::table\n${TABLE}:::\n`)
  })

  it('writes a percentage width and an empty freeze list back as written', () => {
    const model = tableDirective.parse(container('{width=70% freeze=none}'))

    expect(tableDirective.serialize(model).attributes).toEqual({ width: '70%', freeze: 'none' })
  })

  it('finds nothing to wrap when the body is not exactly one table', () => {
    expect(tableOf(container('', 'Prose.\n\n'))).toBeUndefined()
    expect(tableOf(container('', `${TABLE}\nAnd prose.\n`))).toBeUndefined()
  })
})

describe('validating a table directive', () => {
  it('accepts a well-formed one', () => {
    expect(
      tableDirective.validate(
        container('{width=wide columns="1fr 2fr 1fr" freeze=header responsive=stack sort=on}'),
      ),
    ).toEqual([])
  })

  it('says when the wrapper holds anything but one table', () => {
    expect(tableDirective.validate(container('', 'Prose.\n'))).toEqual([
      {
        path: '',
        message: 'A table wrapper holds exactly one table; it is shown as written.',
        severity: 'warning',
      },
    ])
  })

  it('names a width it cannot read, and a percentage outside 1 to 100', () => {
    expect(tableDirective.validate(container('{width=huge}'))).toEqual([
      {
        path: 'width',
        message: 'Unknown table width "huge"; use content, wide, full or a percentage such as 70%.',
        severity: 'warning',
      },
    ])
    expect(tableDirective.validate(container('{width=0%}'))).toHaveLength(1)
    expect(tableDirective.validate(container('{width=140%}'))).toHaveLength(1)
    expect(tableDirective.validate(container('{width=12.5%}'))).toHaveLength(1)
  })

  it('refuses pixels, and anything else that is not a proportion', () => {
    expect(tableDirective.validate(container('{columns="120px 2fr 1fr"}'))).toEqual([
      {
        path: 'columns',
        message:
          'Column widths are proportions such as "2fr 3fr 1fr", never pixels; "120px 2fr 1fr" is ignored.',
        severity: 'warning',
      },
    ])
    expect(tableDirective.validate(container('{columns="0fr 1fr 1fr"}'))).toHaveLength(1)
    expect(tableDirective.validate(container('{columns=""}'))).toHaveLength(1)
  })

  it('says when there is not one width for every column', () => {
    expect(tableDirective.validate(container('{columns="1fr 2fr"}'))).toEqual([
      {
        path: 'columns',
        message: '2 column widths for a 3-column table; they are ignored.',
        severity: 'warning',
      },
    ])
  })

  it('names a part it cannot freeze, and none written beside a part', () => {
    expect(tableDirective.validate(container('{freeze=header,legend}'))).toEqual([
      {
        path: 'freeze',
        message:
          'Unknown freeze "header,legend"; use header, first-column or footer, several separated by commas, or none.',
        severity: 'warning',
      },
    ])
    expect(tableDirective.validate(container('{freeze=none,header}'))).toHaveLength(1)
    expect(tableDirective.validate(container('{freeze=header,header}'))).toHaveLength(1)
  })

  it('names an unknown responsive mode and an unknown sort value', () => {
    expect(
      tableDirective.validate(container('{responsive=cards sort=never}')).map((each) => each.path),
    ).toEqual(['responsive', 'sort'])
  })

  it('has nothing to say about a leaf directive of the same name, which it does not claim', () => {
    const [leaf] = parseMarkdown('::table{width=huge}\n').children
    if (leaf?.type !== 'leafDirective') throw new Error('no leaf directive')

    expect(findDirective(leaf)).toBeUndefined()
    expect(tableDirective.validate(leaf)).toEqual([])
  })

  it('is part of a document check, with its position', () => {
    const tree = parseMarkdown(`:::table{width=huge}\n${TABLE}:::\n`)

    expect(validateDirectives(tree).map((each) => each.path)).toEqual(['table[0].width'])
  })
})

describe('reading options from attributes alone', () => {
  it('is the defaults with no attributes at all', () => {
    expect(readTableOptions(undefined)).toEqual({
      options: DEFAULT_TABLE_OPTIONS,
      other: {},
      issues: [],
    })
  })

  it('treats an attribute without a value as unreadable, and keeps it', () => {
    const read = readTableOptions({ sort: '', width: null })

    expect(read.options.sortable).toBe(true)
    expect(read.other).toEqual({ sort: '', width: null })
    expect(read.issues.map((each) => each.path)).toEqual(['width', 'sort'])
  })
})

describe('the rendered proportions', () => {
  it('turns proportions into percentages of the table', () => {
    expect(columnPercentages([2, 3, 1])).toEqual(['33.33%', '50%', '16.67%'])
    expect(columnPercentages([1])).toEqual(['100%'])
  })

  it('rounds a percentage width to the nearest step the stylesheet draws', () => {
    expect(renderedPercent(55)).toBe(55)
    expect(renderedPercent(57)).toBe(55)
    expect(renderedPercent(58)).toBe(60)
    expect(renderedPercent(1)).toBe(5)
    expect(renderedPercent(100)).toBe(100)
  })
})

describe('row headers, footers and captions', () => {
  it('reads which cells head the table, and how many rows are the footer', () => {
    const model = tableDirective.parse(container('{headers=both footer=1 freeze=footer}'))

    expect(model).toMatchObject({ headers: 'both', footer: 1, freeze: ['footer'] })
    expect(tableDirective.serialize(model).attributes).toEqual({
      headers: 'both',
      footer: '1',
      freeze: 'footer',
    })
  })

  it('names a header kind, a footer or a caption side it cannot read', () => {
    expect(
      tableDirective
        .validate(container('{headers=diagonal footer=0 caption=left}'))
        .map((each) => each.message),
    ).toEqual([
      'Unknown headers "diagonal"; use column or row or both.',
      'A footer is a number of rows, such as footer=1; "0" is not one.',
      'Unknown caption side "left"; use top or bottom.',
    ])
  })

  it('says when the footer is taller than the table, counting the header row with row headers', () => {
    expect(tableDirective.validate(container('{footer=3}'))).toEqual([
      {
        path: 'footer',
        message: 'A footer of 3 rows in a table of 1; every row is the footer.',
        severity: 'warning',
      },
    ])
    expect(tableDirective.validate(container('{headers=row footer=2}'))).toEqual([])
  })

  it('reads the label as the caption, and writes it back first', () => {
    const node = container('[Latency **budgets**]{caption=bottom}')
    const model = tableDirective.parse(node)

    expect(model.captionSide).toBe('bottom')
    expect(model.caption?.children.map((child) => child.type)).toEqual(['text', 'strong'])
    expect(tableOf(node)?.type).toBe('table')
    expect(write(tableDirective.serialize(model))).toBe(
      `:::table[Latency **budgets**]{caption="bottom"}\n${TABLE}:::\n`,
    )
  })
})
