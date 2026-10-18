import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from './html.ts'

/**
 * A callout written as a quote is named in words as well as colour (WCAG 1.4.1),
 * and by the kind the author wrote: a kind Quill draws as one of its own, or one
 * nobody has heard of, is still said as it was written.
 */

const render = (markdown: string): string => renderHtml(parseMarkdown(markdown))

/** The callout's label, the words that name it. */
function labelOf(markdown: string): string | undefined {
  return /<p class="callout-label"[^>]*>(.*?)<\/p>/u.exec(render(markdown))?.[1]
}

describe('the name a callout written as a quote is given', () => {
  it('is its kind, as GitHub titles an alert', () => {
    expect(labelOf('> [!WARNING]\n> Mind the gap.\n')).toBe('Warning')
  })

  it('is its kind, then its title, the kind said only to a screen reader', () => {
    expect(labelOf('> [!tip] Custom title\n> Body.\n')).toBe(
      '<span class="sr-only">Tip: </span>Custom title',
    )
  })

  it('is the kind as written when Quill draws it as another', () => {
    expect(render('> [!faq]\n> Because.\n')).toContain('callout-info')
    expect(labelOf('> [!faq]\n> Because.\n')).toBe('Faq')
  })

  it('is the kind as written, and its title, for a kind nobody knows', () => {
    const html = render('> [!my-own-kind] Hello\n> Body.\n')

    expect(html).toContain('class="callout callout-note"')
    expect(labelOf('> [!my-own-kind] Hello\n> Body.\n')).toBe(
      '<span class="sr-only">My-own-kind: </span>Hello',
    )
    expect(html).not.toContain('[!my-own-kind]')
  })

  it('keeps a directive callout named by its type', () => {
    expect(labelOf(':::callout{type=tip}\nBody.\n:::\n')).toBe('Tip')
  })
})
