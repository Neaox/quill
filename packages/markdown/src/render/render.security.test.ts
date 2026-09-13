import { describe, expect, it } from 'vitest'
import type { ContainerDirective } from 'mdast-util-directive'
import type { Root } from 'mdast'

import { optionalDirective } from '../directives/optional.ts'
import { repeatDirective } from '../directives/repeat.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from './html.ts'

const render = (markdown: string): string => renderHtml(parseMarkdown(markdown))

// A genuine attribute breakout looks like `"` (closing the value early) then a
// new `name="..."` pair: `x" onmouseover="alert(1)`. hast-util-to-html always
// escapes a quote inside an attribute value instead, so this exact shape —
// quote, whitespace, an attribute name, `=`, quote — never legitimately occurs;
// its presence would mean an attacker's value closed the tag's real attribute
// and opened their own.
const ATTRIBUTE_BREAKOUT = /"\s+on[a-z-]+\s*=\s*"/i

/**
 * ADR-011 "Input, output, and content"; `docs/security/review-2026-09-12-m1-auth.md`
 * finding 3. Every case here is something that must never reach a reader's
 * browser as live markup: a `<script>` element, an event-handler attribute, or a
 * `javascript:`/non-image `data:` URL doing anything but sitting inertly as
 * character data. None of it tests that the *content* disappears — ADR-011 asks
 * for an allowlist, not a document that goes blank on hostile input — so most
 * cases also check the harmless remainder (surrounding text, the element the
 * renderer itself builds) still comes through, and that the hostile part
 * survives only as inert, escaped text.
 */
describe('renderHtml: adversarial corpus', () => {
  it('escapes a raw <script> block to inert text', () => {
    const html = render('Before.\n\n<script>alert(document.cookie)</script>\n\nAfter.\n')

    expect(html).not.toContain('<script')
    expect(html).toContain('Before.')
    expect(html).toContain('After.')
    expect(html).toContain('&#x3C;script>alert(document.cookie)&#x3C;/script>')
  })

  it('escapes an inline <img onerror> tag rather than rendering a live image', () => {
    const html = render('Look: <img src=x onerror=alert(1)> there.\n')

    expect(html).not.toContain('<img')
    expect(html).toContain('Look:')
    expect(html).toContain('&#x3C;img src=x onerror=alert(1)>')
  })

  it('strips a javascript: href from a real link but keeps its text', () => {
    const html = render('[click me](javascript:alert(1))\n')

    expect(html).not.toContain('javascript:')
    expect(html).toBe('<article><p><a>click me</a></p></article>')
  })

  it('strips a javascript: src from a real image but keeps the element', () => {
    const html = render('![x](javascript:alert(1))\n')

    expect(html).not.toContain('javascript:')
    expect(html).toContain('<img alt="x">')
  })

  it('rejects a javascript: link written with a pointy-bracket destination', () => {
    const html = render('[click me](<javascript:alert(1)>)\n')

    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('href')
  })

  it('rejects a javascript: link obfuscated with a numeric character reference', () => {
    // CommonMark decodes entities in link destinations, so this parses to the
    // literal string "javascript:alert(1)" before the renderer ever sees it.
    const html = render('[click me](&#106;avascript:alert(1))\n')

    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('href')
  })

  it('escapes a raw <svg onload> element', () => {
    const html = render('<svg onload="alert(1)"></svg>\n')

    expect(html).not.toContain('<svg')
    expect(html).toContain('&#x3C;svg onload="alert(1)">&#x3C;/svg>')
  })

  it('escapes a raw <iframe>', () => {
    const html = render('<iframe src="https://evil.example"></iframe>\n')

    expect(html).not.toContain('<iframe')
  })

  it('escapes a raw <object>', () => {
    const html = render('<object data="javascript:alert(1)"></object>\n')

    expect(html).not.toContain('<object')
  })

  it('escapes a raw <base> tag', () => {
    const html = render('<base href="https://evil.example/">\n')

    expect(html).not.toContain('<base')
  })

  it('escapes a raw <meta http-equiv> redirect', () => {
    const html = render('<meta http-equiv="refresh" content="0;url=https://evil.example">\n')

    expect(html).not.toContain('<meta')
  })

  it('escapes a raw <form> rather than rendering a live one', () => {
    const html = render('<form action="https://evil.example"><input name="x"></form>\n')

    expect(html).not.toContain('<form')
    expect(html).not.toContain('<input')
  })

  it('rejects a data:text/html link', () => {
    const html = render('[click me](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)\n')

    expect(html).not.toContain('data:')
    expect(html).not.toContain('href')
  })

  it('rejects a data:text/html image but allows data:image', () => {
    const html = render(
      [
        '![evil](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
        '',
        '![fine](data:image/png;base64,AAAA)',
        '',
      ].join('\n'),
    )

    expect(html).not.toContain('data:text/html')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
  })

  it('allows only raster data: image types, whatever their case', () => {
    for (const type of ['png', 'jpeg', 'gif', 'webp', 'avif']) {
      expect(render(`![ok](data:image/${type};base64,AAAA)\n`)).toContain(`data:image/${type}`)
    }

    // An SVG is a document: it carries script and fetches external references,
    // and a `data:` one would run with this page's origin.
    expect(render('![no](data:image/svg+xml;base64,AAAA)\n')).not.toContain('data:')
    expect(render('![no](data:image/anything;base64,AAAA)\n')).not.toContain('data:')
    // A media type is case-insensitive, so the pattern is too.
    expect(render('![ok](data:image/PNG;base64,AAAA)\n')).toContain('base64,AAAA')
    // The protocol gate compares a scheme byte for byte, so an uppercased one
    // never reaches the pattern: it is refused outright, in either direction.
    expect(render('![no](DATA:image/svg+xml;base64,AAAA)\n')).not.toContain('svg')
    expect(render('![no](DATA:image/png;base64,AAAA)\n')).not.toContain('base64')
  })

  it('rejects a protocol-relative link, which inherits the page scheme and leaves', () => {
    const html = render('[cdn](//evil.example/x) and [fine](/d/abc) and [also](#heading).\n')

    expect(html).not.toContain('evil.example')
    expect(html).toContain('href="/d/abc"')
    expect(html).toContain('href="#heading"')
  })

  it('escapes raw HTML nested inside a directive', () => {
    const html = render(':::callout{type=warning}\n<script>alert(1)</script>\n:::\n')

    expect(html).not.toContain('<script')
    expect(html).toContain('class="callout callout-warning"')
    expect(html).toContain('&#x3C;script>alert(1)&#x3C;/script>')
  })

  it('escapes raw HTML nested two directives deep', () => {
    const ast: Root = {
      type: 'root',
      children: [
        {
          type: 'containerDirective',
          name: 'wide',
          attributes: {},
          children: [
            {
              type: 'containerDirective',
              name: 'callout',
              attributes: { type: 'note' },
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'html', value: '<img src=x onerror=alert(1)>' }],
                },
              ],
            } as ContainerDirective,
          ],
        } as ContainerDirective,
      ],
    }

    const html = renderHtml(ast)

    expect(html).not.toContain('<img')
    expect(html).toContain('class="layout-wide"')
    expect(html).toContain('class="callout callout-note"')
    expect(html).toContain('&#x3C;img src=x onerror=alert(1)>')
  })

  it('shows an unknown leaf directive as inert text, never as attributes', () => {
    const html = render('::embed{src="https://evil.example" onerror="alert(1)"}\n')

    // The readable fallback of ADR-032 says what the block was, parameters and
    // all, so a reader is not left with a silently empty line — but every one of
    // them is text inside a paragraph, not an attribute on an element and not a
    // URL anything will fetch.
    expect(html).toBe(
      [
        '<article><section class="live-block" data-live-block="embed"',
        ' aria-label="Live block: embed">\n',
        '<p>::embed{src="https://evil.example" onerror="alert(1)"}</p>\n',
        '</section></article>',
      ].join(''),
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<a ')
  })

  it('cannot close the slot section from a directive name or attribute', () => {
    const html = render('A :name{a="</section><script>alert(1)</script>"} and :</p><script>x.\n')

    expect(html).not.toContain('<script')
    expect(html).not.toContain('</section>')
    expect(html).toContain('&#x3C;/p>&#x3C;script>x.')
  })

  it('falls back to the default type when a callout type attribute carries markup', () => {
    const html = render(':::callout{type="<script>alert(1)</script>"}\nBody.\n:::\n')

    expect(html).not.toContain('<script')
    expect(html).toContain('class="callout callout-note"')
    expect(html).toContain('aria-label="Note"')
    expect(html).toContain('<p>Body.</p>')
  })
})

describe('renderHtml: directive attribute injection', () => {
  it('cannot break out of the aria-label attribute from an optional section title', () => {
    const model = optionalDirective.serialize({
      title: 'Alternatives" onmouseover="alert(1)',
      added: false,
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Body' }] }],
    })
    const ast: Root = { type: 'root', children: [model] }

    const html = renderHtml(ast)

    expect(html).not.toMatch(ATTRIBUTE_BREAKOUT)
    expect(html).toContain(
      'aria-label="Optional section: Alternatives&#x22; onmouseover=&#x22;alert(1)"',
    )
  })

  it('cannot break out of the aria-label attribute from a repeat section title', () => {
    const model = repeatDirective.serialize({
      title: 'x"><script>alert(1)</script>',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Body' }] }],
    })
    const ast: Root = { type: 'root', children: [model] }

    const html = renderHtml(ast)

    expect(html).not.toMatch(ATTRIBUTE_BREAKOUT)
    // The `<script>` here is inert: it sits inside the still-open, quoted
    // `aria-label` value (its own `"` was escaped to `&#x22;`), never as a
    // sibling element, so this is the safe outcome, not a missed case.
    expect(html).toContain('aria-label="Repeatable section: x&#x22;><script>alert(1)</script>"')
  })

  it('cannot inject a live tag through a :kbd label', () => {
    const html = render('Press :kbd[<img src=x onerror=alert(1)>] to stop.\n')

    expect(html).not.toContain('<img')
    expect(html).toContain('<kbd>&#x3C;img src=x onerror=alert(1)></kbd>')
  })

  it('cannot break the callout label paragraph out of its own tag', () => {
    const ast: Root = {
      type: 'root',
      children: [
        {
          type: 'containerDirective',
          name: 'callout',
          attributes: { type: 'note' },
          children: [
            {
              type: 'paragraph',
              data: { directiveLabel: true },
              children: [{ type: 'text', value: '</p><script>alert(1)</script>' }],
            },
            { type: 'paragraph', children: [{ type: 'text', value: 'Body.' }] },
          ],
        } as ContainerDirective,
      ],
    }

    const html = renderHtml(ast)

    expect(html).not.toMatch(ATTRIBUTE_BREAKOUT)
    // The label text is escaped where it becomes element content (the
    // `callout-label` paragraph)...
    expect(html).toContain(
      '<p class="callout-label">&#x3C;/p>&#x3C;script>alert(1)&#x3C;/script></p>',
    )
    // ...and, inside the quoted `aria-label` value, stays inert for the same
    // reason as the repeat-title case above: its own `<` needs no escaping to
    // stay contained, because no unescaped `"` ever ends the attribute early.
    expect(html).toContain('aria-label="</p><script>alert(1)</script>"')
    expect(html).toContain('<p>Body.</p>')
  })
})
