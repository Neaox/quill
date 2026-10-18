import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { renderHtml } from './html.ts'
import type { LinkRewrite } from './rewrite-links.ts'
import { rewriteLinks } from './rewrite-links.ts'

function render(markdown: string): string {
  return renderHtml(parseDocument(markdown).ast)
}

const KEEP: LinkRewrite = { kind: 'keep' }

describe('rewriteLinks', () => {
  it('gives a link a new address and keeps its words and its other attributes', () => {
    const html = render('See [the guide](/d/abc "Guide") now.')

    const rewritten = rewriteLinks(html, (href) =>
      href === '/d/abc' ? { kind: 'href', href: '/s/docs/guide' } : KEEP,
    )

    expect(rewritten).toContain('<a href="/s/docs/guide" title="Guide">the guide</a>')
    expect(rewritten).not.toContain('/d/abc')
  })

  it('turns a link that must not be followed into its words, with nothing of its address left', () => {
    const html = render('See [the **secret** plan](/d/abc#part) now.')

    const rewritten = rewriteLinks(html, () => ({ kind: 'text' }))

    expect(rewritten).toContain('See the <strong>secret</strong> plan now.')
    expect(rewritten).not.toContain('<a ')
    expect(rewritten).not.toContain('/d/abc')
  })

  it('leaves a readdressed preview slot no key that names the stored address', () => {
    const id = '0192f0a4-7c1e-7a3b-8d1e-4a5b6c7d8e9f'
    const html = render(`See [the plan](/d/${id})<!-- quill:link display=inline --> now.`)
    expect(html).toContain(`data-link-key="/d/${id}"`)

    const moved = rewriteLinks(html, () => ({ kind: 'href', href: '/s/docs/plan' }))
    expect(moved).toContain('href="/s/docs/plan"')
    expect(moved).not.toContain(id)

    const words = rewriteLinks(html, () => ({ kind: 'text' }))
    expect(words).toContain('See the plan now.')
    expect(words).not.toContain(id)
  })

  it('handles every link in the body, nested or not', () => {
    const html = render(['- [one](/d/a)', '- [two](/d/b)', '', '> [three](/d/c)'].join('\n'))
    const seen: string[] = []

    rewriteLinks(html, (href) => {
      seen.push(href)
      return KEEP
    })

    expect(seen).toEqual(['/d/a', '/d/b', '/d/c'])
  })

  it('returns the very same string when nothing changes, so a body is not reserialised for nothing', () => {
    const html = render('[out](https://example.com) and [in](/d/a)')

    expect(rewriteLinks(html, () => KEEP)).toBe(html)
  })

  it('does not parse a body that has no links at all', () => {
    const html = render('Just words.')
    let asked = false

    expect(
      rewriteLinks(html, () => {
        asked = true
        return KEEP
      }),
    ).toBe(html)
    expect(asked).toBe(false)
  })
})
