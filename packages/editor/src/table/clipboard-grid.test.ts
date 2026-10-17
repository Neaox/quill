import { describe, expect, it } from 'vitest'

import { gridFromHtml, gridFromText } from './clipboard-grid.ts'
import type { PastedGrid } from './clipboard-grid.ts'

function texts(grid: PastedGrid | undefined): string[][] {
  if (grid === undefined) throw new Error('no grid')
  return grid.rows.map((row) => row.map((cell) => cell.text))
}

/** What Excel puts on the clipboard, trimmed to what matters here. */
const EXCEL = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body>
<table border=0 cellpadding=0 cellspacing=0>
 <col width=64><col width=64 style='display:none'><col width=64>
 <tr height=20><td>Region</td><td style='display:none'>hidden</td><td>Budget</td><td></td></tr>
 <tr height=20><td colspan=2>eu-west-1</td><td>120</td><td></td></tr>
 <tr style='display:none'><td>secret</td><td>1</td></tr>
 <tr height=20><td><b>us</b>-east-1</td><td>90</td><td></td></tr>
 <tr height=20><td></td><td></td><td></td></tr>
</table></body></html>`

describe('a pasted HTML table', () => {
  it('drops hidden rows and columns and empty trailing ones, and unwinds spans', () => {
    const grid = gridFromHtml(EXCEL, document)

    expect(texts(grid)).toEqual([
      ['Region', 'Budget', ''],
      ['eu-west-1', '', '120'],
      ['us-east-1', '90', ''],
    ])
    // The span held words: the author is told the merge was undone.
    expect(grid?.unmerged).toBe(true)
    expect(grid?.rows[2]?.[0]?.element?.querySelector('b')?.textContent).toBe('us')
  })

  it('unwinds a phantom merge over empty cells silently, rows as well as columns', () => {
    const grid = gridFromHtml(
      `<google-sheets-html-origin><table><tr><td rowspan="2" colspan="2"></td><td>a</td></tr><tr><td>b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table>`,
      document,
    )

    expect(texts(grid)).toEqual([
      ['', '', 'a'],
      ['', '', 'b'],
      ['c', 'd', 'e'],
    ])
    expect(grid?.unmerged).toBe(false)
  })

  it('fills a place a rowspan covers at the end of a row', () => {
    expect(
      texts(
        gridFromHtml(
          '<table><tr><td>a</td><td rowspan=2>x</td></tr><tr><td>b</td></tr></table>',
          document,
        ),
      ),
    ).toEqual([
      ['a', 'x'],
      ['b', ''],
    ])
  })

  it('pads a row that is shorter than the widest with empty cells', () => {
    const grid = gridFromHtml(
      '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>',
      document,
    )
    expect(texts(grid)).toEqual([
      ['a', 'b'],
      ['c', ''],
    ])
  })

  it('is no grid without a table, or with an empty one', () => {
    expect(gridFromHtml('<p>Words.</p>', document)).toBeUndefined()
    expect(gridFromHtml('<table></table>', document)).toBeUndefined()
    expect(gridFromHtml('<!-- <table> -->', document)).toBeUndefined()
    expect(gridFromHtml('<table><tr><td> </td></tr></table>', document)).toBeUndefined()
  })

  it('reads a span it cannot use as one cell', () => {
    expect(
      texts(
        gridFromHtml(
          '<table><tr><td colspan="x">a</td><td colspan="0">b</td></tr></table>',
          document,
        ),
      ),
    ).toEqual([['a', 'b']])
  })
})

describe('pasted tab-separated text', () => {
  it('reads rows and cells, quoted fields with tabs, breaks and quotes in them', () => {
    const grid = gridFromText('Region\tNote\r\neu\t"a\tb"\nus\t"said ""hi""\nthere"\n')

    expect(texts(grid)).toEqual([
      ['Region', 'Note'],
      ['eu', 'a b'],
      ['us', 'said "hi" there'],
    ])
    expect(grid?.unmerged).toBe(false)
  })

  it('is no grid without a tab, or with nothing in it', () => {
    expect(gridFromText('Just words.\nOn two lines.')).toBeUndefined()
    expect(gridFromText('\t\n\t')).toBeUndefined()
  })
})
