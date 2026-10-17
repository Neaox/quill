import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from './html.ts'

const render = (markdown: string): string => renderHtml(parseMarkdown(markdown))

describe('footnotes', () => {
  it('link each reference and its back-link to ids that exist, prefixed once', () => {
    const html = render('A claim.[^1]\n\n[^1]: The source.\n')

    expect(html).not.toContain('user-content-user-content')
    for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) {
      expect(html).toContain(`id="${target}"`)
    }
  })
})

describe('tables', () => {
  it('keep an escaped pipe inside its cell', () => {
    const html = render(String.raw`| a |
| - |
| x \| y |
`)

    expect(html).toContain('<td>x | y</td>')
  })
})

describe('footnotes, described', () => {
  it('describe a reference by the footnotes heading it names', () => {
    const html = render('A claim.[^1]\n\n[^1]: The source.\n')

    expect(html).toContain('aria-describedby="user-content-footnote-label"')
    expect(html).toContain('id="user-content-footnote-label"')
  })
})
