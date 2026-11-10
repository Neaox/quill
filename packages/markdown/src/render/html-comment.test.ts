import { describe, expect, it } from 'vitest'

import { parseMarkdown, stringifyMdast } from '../pipeline/processor.ts'
import { mdastToProseMirror } from '../prosemirror/from-mdast.ts'
import { proseMirrorToMdast } from '../prosemirror/to-mdast.ts'
import { renderHtml } from './html.ts'
import { isHtmlComment } from './html-comment.ts'
import { extractText } from './text.ts'

const render = (markdown: string): string => renderHtml(parseMarkdown(markdown))

describe('an HTML comment', () => {
  it('is hidden when it is a block of its own', () => {
    const html = render(
      'Before.\n\n<!-- generated:start -->\n## Table\n\nAfter.\n\n<!-- generated:end -->\n',
    )

    expect(html).not.toContain('generated')
    expect(html).not.toContain('&#x3C;!--')
    expect(html).toContain('Table')
    expect(html).toContain('After.')
  })

  it('is hidden inline, in prose and in a table cell', () => {
    const html = render(
      'Ships <!-- check with the printer --> on Monday.\n\n| a |\n| - |\n| x <!-- note --> |\n',
    )

    expect(html).toContain('Ships  on Monday.')
    expect(html).not.toContain('printer')
    expect(html).not.toContain('note')
  })

  it('is hidden when it spans lines, and when several share a block', () => {
    expect(render('<!--\nTODO: rewrite\n-->\n\n<!-- a --> <!-- b -->\n')).not.toContain('TODO')
    expect(render('<!-- a --> <!-- b -->\n')).not.toContain('a --')
  })

  it('hides the rest of the document when it never closes, as a browser and GitHub do', () => {
    const html = render('Shown.\n\n<!-- left open\n\nHidden too.\n')

    expect(html).toContain('Shown.')
    expect(html).not.toContain('Hidden')
  })

  it('leaves other raw HTML escaped, comment and all', () => {
    const html = render('<div>kept <!-- inside --></div>\n')

    expect(html).toContain('&#x3C;div>kept &#x3C;!-- inside -->&#x3C;/div>')
  })

  it('is not indexed for search', () => {
    const text = extractText(parseMarkdown('Ships <!-- secret --> soon.\n\n<!-- also secret -->\n'))

    expect(text.body).not.toContain('secret')
    expect(text.body).toContain('Ships')
  })

  it('stays in the source byte for byte through the editor', () => {
    const source =
      'Ships <!-- check with the printer --> soon.\n\n<!-- generated:start -->\n\nText.\n'
    const { doc } = mdastToProseMirror(parseMarkdown(source))

    expect(stringifyMdast(proseMirrorToMdast(doc).tree)).toBe(source)
  })
})

describe('isHtmlComment', () => {
  it('reads the empty comments CommonMark allows', () => {
    expect(isHtmlComment('<!---->')).toBe(true)
    expect(isHtmlComment('<!-->')).toBe(true)
    expect(isHtmlComment('<!--->')).toBe(true)
  })

  it('is false for anything besides comments', () => {
    expect(isHtmlComment('<!-- a --> <b>')).toBe(false)
    expect(isHtmlComment('<br>')).toBe(false)
  })
})
