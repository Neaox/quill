// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { readTable, tableToCsv, tableToMarkdown } from './table-text.ts'

function table(html: string): HTMLTableElement {
  document.body.innerHTML = `<table>${html}</table>`
  const found = document.querySelector('table')
  if (found === null) throw new Error('no table')
  return found
}

const SHOWN = `<caption>Budgets</caption>
<thead><tr><th><button>Region<span class="table-sort-icon"></span></button></th><th class="align-numeric">Budget</th><th class="align-center">Note</th></tr></thead>
<tbody><tr><th scope="row">us, east</th><td class="align-numeric">1,250</td><td class="align-center">said "fast" | slow</td></tr></tbody>
<tfoot><tr><th scope="row">Total</th><td class="align-numeric">1,250</td><td class="align-center"></td></tr></tfoot>`

describe('a table as text', () => {
  it('reads every row as shown, the caption left out, and each column’s alignment', () => {
    expect(readTable(table(SHOWN))).toEqual({
      rows: [
        ['Region', 'Budget', 'Note'],
        ['us, east', '1,250', 'said "fast" | slow'],
        ['Total', '1,250', ''],
      ],
      header: true,
      align: [null, 'right', 'center'],
    })
  })

  it('writes CSV a spreadsheet reads, quoting what needs it', () => {
    expect(tableToCsv(readTable(table(SHOWN)))).toBe(
      'Region,Budget,Note\r\n"us, east","1,250","said ""fast"" | slow"\r\nTotal,"1,250",',
    )
  })

  it('writes GFM Markdown, alignment kept and pipes escaped', () => {
    expect(tableToMarkdown(readTable(table(SHOWN)))).toBe(
      [
        '| Region | Budget | Note |',
        '| --- | --: | :-: |',
        '| us, east | 1,250 | said "fast" \\| slow |',
        '| Total | 1,250 |  |',
      ].join('\n'),
    )
  })

  it('gives a table headed by its rows an empty header row, and pads short rows', () => {
    const text = readTable(
      table('<tbody><tr><th class="align-left">A</th><td>1</td></tr><tr><th>B</th></tr></tbody>'),
    )

    expect(text.header).toBe(false)
    expect(text.align).toEqual([null, null])
    expect(tableToMarkdown(text)).toBe(
      ['|  |  |', '| --- | --- |', '| A | 1 |', '| B |  |'].join('\n'),
    )
  })

  it('reads an empty table as nothing', () => {
    expect(tableToMarkdown(readTable(table('')))).toBe('|  |\n|  |')
  })
})
