import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from './html.ts'

const render = (markdown: string): string => renderHtml(parseMarkdown(markdown))

const TABLE =
  '| Region | Owner | Budget |\n| - | - | - |\n| eu | Platform | 120 |\n| us | Data | 1,250.5 |\n'

const wrapped = (attributes: string, body = TABLE): string =>
  render(`:::table${attributes}\n${body}:::\n`)

describe('a table block', () => {
  it('is a block around the scroll container, so a header can stick outside the scroller', () => {
    expect(render(TABLE)).toContain(
      '<div class="table-block"><div class="table-scroll" tabindex="0" role="group" aria-label="Table"><table>\n<thead>',
    )
    expect(render(TABLE)).toContain('</table></div></div>')
  })

  it('renders a wrapper with no attributes exactly as the bare table', () => {
    expect(wrapped('')).toBe(render(TABLE))
  })

  it('carries its width as data the reading grid places it by', () => {
    expect(wrapped('{width=full}')).toContain('<div class="table-block" data-width="full">')
    expect(wrapped('{width=content}')).toContain('<div class="table-block" data-width="content">')
    expect(wrapped('{width=57%}')).toContain(
      '<div class="table-block" data-width="percent" data-percent="55">',
    )
  })

  it('sets proportional column widths in a column group', () => {
    expect(wrapped('{columns="2fr 3fr 1fr"}')).toContain(
      '<table>\n<colgroup><col width="33.33%"><col width="50%"><col width="16.67%"></colgroup>\n<thead>',
    )
  })

  it('ignores column widths that do not match the columns, rather than guessing', () => {
    expect(wrapped('{columns="1fr 2fr"}')).not.toContain('<colgroup>')
  })

  it('says what is frozen, how it responds and whether it sorts', () => {
    expect(wrapped('{freeze=first-column,header responsive=stack sort=off}')).toContain(
      '<div class="table-block" data-freeze="header first-column" data-responsive="stack" data-sort="off">',
    )
    expect(wrapped('{freeze=none}')).toContain('<div class="table-block" data-freeze="none">')
    expect(wrapped('{freeze=header}')).toContain('<div class="table-block" data-freeze="header">')
    expect(wrapped('{responsive=scroll sort=on}')).toContain('<div class="table-block">')
  })

  it('renders an unreadable option as the default, keeping the table', () => {
    expect(wrapped('{width=huge freeze=legend}')).toBe(render(TABLE))
  })

  it('degrades a wrapper around anything but one table to its contents', () => {
    const html = wrapped('{width=full}', `Before.\n\n${TABLE}`)

    expect(html).toContain('<p>Before.</p>')
    expect(html).toContain('<div class="table-block"><div class="table-scroll"')
    expect(html).not.toContain('data-width')
  })
})

describe('numeric columns', () => {
  it('right-aligns a column whose body cells are all numbers, head included', () => {
    const html = render(TABLE)

    expect(html).toContain('<th scope="col" class="align-numeric">Budget</th>')
    expect(html).toContain('<td class="align-numeric">1,250.5</td>')
    expect(html).toContain('<th scope="col">Owner</th>')
  })

  it('reads currencies, signs, percentages and short units as numbers, and blanks as nothing', () => {
    const html = render('| A |\n| - |\n| $1,200 |\n| −3.5 % |\n| 120 ms |\n| 45% |\n|  |\n| — |\n')

    expect(html).toContain('<th scope="col" class="align-numeric">A</th>')
  })

  it('reads a missing cell in a short row as blank', () => {
    expect(render('| A | B |\n| - | - |\n| x |\n| y | 3 |\n')).toContain(
      '<td class="align-numeric">3</td>',
    )
  })

  it('leaves a column alone when any cell is not a number', () => {
    const html = render('| A |\n| - |\n| 1 |\n| 1.2.3 |\n')

    expect(html).not.toContain('align-numeric')
  })

  it('leaves a column of blanks alone', () => {
    expect(render('| A | B |\n| - | - |\n| x |  |\n')).not.toContain('align-numeric')
  })

  it("never overrides the author's own alignment", () => {
    const html = render('| A |\n| :-: |\n| 1 |\n')

    expect(html).toContain('<th scope="col" class="align-center">A</th>')
    expect(html).not.toContain('align-numeric')
  })
})

describe('column shapes', () => {
  it('keeps a column of single tokens on one line, so dates and identifiers never break', () => {
    const html = render(
      '| Region | Since |\n| - | - |\n| eu-west-1 | 2026-01-01 |\n| — | 2026-02-01 |\n',
    )

    expect(html).toContain('<td class="column-nowrap">eu-west-1</td>')
    expect(html).toContain('<th scope="col" class="column-nowrap">Since</th>')
  })

  it('gives a column of running text room to read before the table scrolls', () => {
    const long = 'Routes traffic for the region and fails over to its pair'
    const html = render(
      `| Notes | Short words |\n| - | - |\n| ${long} | a b |\n| ${long} | c d |\n`,
    )

    expect(html).toContain(`<td class="column-long">${long}</td>`)
    expect(html).toContain('<td>a b</td>')
  })

  it('keeps the author’s alignment beside a shape', () => {
    expect(render('| A |\n| :-: |\n| 2026-01-01 |\n')).toContain(
      '<td class="align-center column-nowrap">2026-01-01</td>',
    )
  })

  it('gives a column of blanks or of over-long tokens no shape', () => {
    const token = 'x'.repeat(36)
    const html = render(`| A | B |\n| - | - |\n|  | ${token} |\n`)

    expect(html).toContain(`<td>${token}</td>`)
    expect(html).not.toContain('column-')
  })
})

describe('stacked tables', () => {
  it('labels every cell with its column and keeps table roles when restyled as cards', () => {
    const html = wrapped('{responsive=stack}')

    expect(html).toContain('<table role="table">\n<thead role="rowgroup">\n<tr role="row">')
    expect(html).toContain('<th scope="col" role="columnheader">Region</th>')
    expect(html).toContain('<tbody role="rowgroup">\n<tr role="row">')
    expect(html).toContain('<td data-label="Region" role="cell">eu</td>')
    expect(html).toContain('<td class="align-numeric" data-label="Budget" role="cell">120</td>')
  })

  it('takes the label from the header text, bounded', () => {
    const long = 'A'.repeat(120)
    const html = wrapped('{responsive=stack}', `| **${long}** |\n| - |\n| x |\n`)

    expect(html).toContain(`data-label="${'A'.repeat(80)}"`)
  })

  it('labels a cell beyond the header row with nothing, and a short row stays short', () => {
    const html = wrapped('{responsive=stack}', '| A |\n| - |\n| 1 | 2 |\n| 3 |\n')

    expect(html).toContain('<td class="align-numeric" data-label="" role="cell">2</td>')
  })

  it('does not label cells of a table that scrolls', () => {
    expect(render(TABLE)).not.toContain('data-label')
  })
})

describe('row headers', () => {
  it('heads every body row with its first cell, scoped to the row', () => {
    const html = wrapped('{headers=both}')

    expect(html).toContain('<div class="table-block" data-headers="both">')
    expect(html).toContain('<th scope="col">Region</th>')
    expect(html).toContain('<th scope="row">eu</th>')
    expect(html).toContain('<td>Platform</td>')
  })

  it('reads the header row as an ordinary row when only rows have headers', () => {
    const html = wrapped('{headers=row}', '| Owner | Platform |\n| - | - |\n| Budget | 120 |\n')

    expect(html).not.toContain('<thead>')
    expect(html).toContain('<th scope="row">Owner</th>')
    expect(html).toContain('<th scope="row">Budget</th>')
  })

  it('gives a stacked row header its role, and no repeated label', () => {
    const html = wrapped('{headers=both responsive=stack}')

    expect(html).toContain('<th scope="row" role="rowheader">eu</th>')
    expect(html).toContain('<td data-label="Owner" role="cell">Platform</td>')
  })

  it('labels no stacked cell when there is no header row to take a name from', () => {
    const html = wrapped('{headers=row responsive=stack}', '| A | 1 |\n| - | - |\n| B | 2 |\n')

    expect(html).toContain('<td class="align-numeric" role="cell">1</td>')
    expect(html).not.toContain('data-label')
  })
})

describe('footers', () => {
  const TOTALS = '| Region | Budget |\n| - | - |\n| eu | 120 |\n| us | 90 |\n| Total | 210 |\n'

  it('sets the last rows in a tfoot, after the body', () => {
    const html = wrapped('{footer=1 headers=both}', TOTALS)

    expect(html).toContain(
      '</tbody>\n<tfoot>\n<tr>\n<th scope="row">Total</th>\n<td class="align-numeric">210</td>\n</tr>\n</tfoot>',
    )
    expect(html.indexOf('<tbody>')).toBeLessThan(html.indexOf('<tfoot>'))
  })

  it('makes every row the footer when it asks for more rows than there are', () => {
    const html = wrapped('{footer=9}', TOTALS)

    expect(html).not.toContain('<tbody>')
    expect(html).toContain('<tfoot>')
  })

  it('gives a stacked footer its row group role', () => {
    expect(wrapped('{footer=1 responsive=stack}', TOTALS)).toContain('<tfoot role="rowgroup">')
  })
})

describe('captions', () => {
  it('captions the table with its label, and names the scroll region by it', () => {
    const html = wrapped('[Latency *budgets*]')

    expect(html).toContain(
      '<div class="table-scroll" tabindex="0" role="group" aria-labelledby="user-content-caption.1"><table>\n<caption id="user-content-caption.1"><span class="table-caption-text">Latency <em>budgets</em></span></caption>',
    )
    expect(html).not.toContain('aria-label="Table"')
  })

  it('numbers captions within a document, and says when one goes below', () => {
    const html = render(
      `:::table[One]\n${TABLE}:::\n\n:::table[Two]{caption=bottom}\n${TABLE}:::\n`,
    )

    expect(html).toContain('id="user-content-caption.2"')
    expect(html).toContain('<div class="table-block" data-caption="bottom">')
  })

  it('reads a figure of one table exactly as a captioned table', () => {
    const labelled = wrapped('[Latency budgets]')
    const figure = render(`:::figure\n${TABLE}\nLatency budgets\n:::\n`)
    const wrappedFigure = render(`::::figure\n:::table\n${TABLE}:::\n\nLatency budgets\n::::\n`)

    expect(figure).toBe(labelled)
    expect(wrappedFigure).toBe(labelled)
  })

  it('keeps a several-paragraph figure caption as paragraphs in the caption', () => {
    const html = render(`:::figure\n${TABLE}\nFirst.\n\nSecond.\n:::\n`)

    expect(html).toContain('<span class="table-caption-text"><p>First.</p><p>Second.</p></span>')
  })

  it('leaves a figure alone that holds more than one table, or a captioned one, or none', () => {
    expect(render(`:::figure\n${TABLE}\n${TABLE}\nCaption.\n:::\n`)).toContain('<figcaption>')
    expect(render(`::::figure\n:::table[Own]\n${TABLE}:::\n\nCaption.\n::::\n`)).toContain(
      '<figcaption>',
    )
    expect(render(`::::figure\n:::cards\nA\n:::\n\nCaption.\n::::\n`)).toContain('<figcaption>')
    expect(render(`:::figure\n${TABLE}:::\n`)).not.toContain('<caption')
  })
})
