import { describe, expect, it } from 'vitest'

import { googleDocsHtml, plainText, wordHtml } from './paste-fixtures.ts'

describe('the paste budget clipboards', () => {
  it('puts Google Docs markup, with every kind of block, in each section', () => {
    const html = googleDocsHtml(4)

    expect(html).toContain('docs-internal-guid')
    expect(html.match(/<h2 /gu)).toHaveLength(4)
    expect(html.match(/<table /gu)).toHaveLength(4)
    expect(html.match(/<pre>/gu)).toHaveLength(4)
    expect(html.match(/<img /gu)).toHaveLength(1)
  })

  it('puts Word markup, with its list paragraphs and Office noise, in each section', () => {
    const html = wordHtml(4)

    expect(html).toContain('<!--StartFragment-->')
    expect(html.match(/class=MsoListParagraphCx/gu)).toHaveLength(12)
    expect(html.match(/<table class=MsoTableGrid/gu)).toHaveLength(4)
    expect(html).toContain('<o:p></o:p>')
    expect(html.match(/<img /gu)).toHaveLength(1)
  })

  it('breaks plain text into paragraphs of four lines', () => {
    const lines = plainText(10).split('\n')

    expect(lines).toHaveLength(10)
    expect(lines.filter((line) => line === '')).toHaveLength(2)
  })
})
