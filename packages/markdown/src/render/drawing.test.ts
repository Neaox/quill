import { toHtml } from 'hast-util-to-html'
import { describe, expect, it } from 'vitest'

import { sanitizeDrawing } from './drawing.ts'

const draw = (markup: string, label = 'A diagram'): string => {
  const drawing = sanitizeDrawing(markup, { idPrefix: 'user-content-d1-', label })
  return drawing === null ? '<none>' : toHtml(drawing, { space: 'svg' })
}

const LOOP = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" font-family="Figtree, sans-serif" viewBox="0 0 1220 560" width="1220">
  <style>.box { fill: #fff }</style>
  <defs>
    <marker id="o1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow-send"/></marker>
  </defs>
  <!-- Your side -->
  <rect x="20" y="150" width="160" height="60" rx="8" class="box planned"/>
  <text x="100" y="176" class="title" text-anchor="middle">Owner's PMS &amp; team</text>
  <line x1="180" y1="180" x2="228" y2="180" class="send" marker-end="url(#o1)"/>
</svg>`

describe('sanitizeDrawing', () => {
  it('keeps the drawing, its classes and its geometry', () => {
    const html = draw(LOOP)

    expect(html).toContain('viewBox="0 0 1220 560"')
    expect(html).toContain(
      '<rect x="20" y="150" width="160" height="60" rx="8" class="box planned"',
    )
    expect(html).toContain('text-anchor="middle">Owner\'s PMS &#x26; team</text>')
    expect(html).toContain('refX="9"')
    expect(html).toContain('orient="auto-start-reverse"')
  })

  it('removes its own stylesheet, its comments and its fixed size', () => {
    const html = draw(LOOP)

    expect(html).not.toContain('<style')
    expect(html).not.toContain('.box {')
    expect(html).not.toContain('Your side')
    expect(html).not.toMatch(/<svg[^>]* width=/)
  })

  it('prefixes every id and every reference to one', () => {
    const html = draw(LOOP)

    expect(html).toContain('id="user-content-d1-o1"')
    expect(html).toContain('marker-end="url(#user-content-d1-o1)"')
    expect(html).not.toContain('"o1"')
  })

  it('is an image named by the alternative text', () => {
    expect(draw(LOOP, 'Facts enter through the gateway')).toMatch(
      /^<svg [^>]*role="img" aria-label="Facts enter through the gateway"/,
    )
  })

  it('returns nothing for markup that is not a drawing', () => {
    expect(draw('<p>hello</p>')).toBe('<none>')
    expect(draw('')).toBe('<none>')
  })
})

describe('sanitizeDrawing against hostile drawings', () => {
  const hostile = [
    ['a script element', '<svg><script>alert(1)</script><rect/></svg>', ['script', 'alert']],
    [
      'an event handler',
      '<svg onload="alert(1)"><rect onclick="alert(2)"/></svg>',
      ['onload', 'onclick', 'alert'],
    ],
    [
      'a link to script',
      '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
      ['javascript', '<a'],
    ],
    [
      'foreign HTML',
      '<svg><foreignObject><img src="x" onerror="alert(1)"/></foreignObject></svg>',
      ['foreignObject', '<img', 'onerror'],
    ],
    [
      'an external image',
      '<svg><image href="https://evil.example/x.png"/></svg>',
      ['image', 'evil.example'],
    ],
    [
      'an external use',
      '<svg><use href="https://evil.example/s.svg#x"/><use xlink:href="#a"/></svg>',
      ['<use', 'evil.example'],
    ],
    [
      'an animation that rewrites a link',
      '<svg><a><animate attributeName="href" to="javascript:alert(1)"/></a><set attributeName="onmouseover" to="alert(1)"/></svg>',
      ['animate', '<set', 'javascript', 'alert'],
    ],
    [
      'a paint server outside the drawing',
      '<svg><rect fill="url(https://evil.example/p.svg#g)" stroke="url(&quot;javascript:alert(1)&quot;)"/></svg>',
      ['evil.example', 'javascript', 'url('],
    ],
    [
      'an inline style',
      '<svg><rect style="background:url(https://evil.example/t)"/></svg>',
      ['style', 'evil.example'],
    ],
    [
      'an encoded scheme',
      '<svg><a href="&#106;avascript:alert(1)"><text>x</text></a></svg>',
      ['avascript', 'alert'],
    ],
    [
      'a CSS expression in a presentation attribute',
      '<svg><rect fill="expression(alert(1))" transform="url(#x) translate(1)"/></svg>',
      ['expression', 'alert', 'url('],
    ],
    [
      'a class that breaks out of the attribute',
      '<svg><rect class="box&quot; onmouseover=&quot;alert(1)"/></svg>',
      ['onmouseover', 'alert'],
    ],
  ] as const

  for (const [name, markup, absent] of hostile) {
    it(`removes ${name}`, () => {
      const html = draw(markup)

      for (const fragment of absent) expect(html).not.toContain(fragment)
    })
  }

  it('keeps text that merely looks like markup, as text', () => {
    expect(draw('<svg><text>&lt;script&gt;alert(1)&lt;/script&gt;</text></svg>')).toContain(
      '<text>&#x3C;script>alert(1)&#x3C;/script></text>',
    )
  })

  it('keeps an internal paint server and plain colours', () => {
    const html = draw(
      '<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)" stroke="oklch(50% 0.1 190)"/><circle fill="none" stroke="currentColor"/></svg>',
    )

    expect(html).toContain('fill="url(#user-content-d1-g)"')
    expect(html).toContain('stroke="oklch(50% 0.1 190)"')
    expect(html).toContain('stop-color="#fff"')
    expect(html).toContain('fill="none"')
  })

  it('refuses a drawing too large to be a diagram', () => {
    const rects = '<rect/>'.repeat(20_001)

    expect(draw(`<svg>${rects}</svg>`)).toBe('<none>')
  })
})

describe('sanitizeDrawing, attribute by attribute', () => {
  it('keeps well-formed values and drops malformed ones', () => {
    const html = draw(
      [
        '<svg width="120" height="80">',
        '<g transform="translate(10, 20) scale(2)" font-family="Figtree, sans-serif">',
        '<rect id="1bad" x="calc(1px)" y="4" stroke-width="2" hidden marker-start="none" marker-end="url(https://x/y#m)" clip-path="url(#c)"/>',
        '<text font-family="a;b{}" transform="translate(1) url(#x)">t</text>',
        '</g></svg>',
      ].join(''),
      '',
    )

    expect(html).toContain('viewBox="0 0 120 80"')
    expect(html).toContain('aria-label="Diagram"')
    expect(html).toContain('transform="translate(10, 20) scale(2)"')
    expect(html).toContain('font-family="Figtree, sans-serif"')
    expect(html).toContain('marker-start="none"')
    expect(html).toContain('clip-path="url(#user-content-d1-c)"')
    expect(html).toContain('y="4"')
    expect(html).toContain('stroke-width="2"')
    for (const dropped of ['1bad', 'calc(', 'hidden', 'https://x', 'a;b', 'url(#x)']) {
      expect(html).not.toContain(dropped)
    }
  })

  it('gives a drawing with neither a box nor a size no viewBox at all', () => {
    expect(draw('<svg width="auto"><rect/></svg>')).not.toContain('viewBox')
  })
})

describe('sanitizeDrawing, style declarations', () => {
  it('reads paint and geometry from a style as the attributes they override', () => {
    const html = draw(
      '<svg viewBox="0 0 9 9"><rect fill="#fff" stroke="#000" style="fill: #eee; stroke-width: 2; opacity:0.5"/></svg>',
    )

    expect(html).toContain('fill="#eee"')
    expect(html).toContain('stroke="#000"')
    expect(html).toContain('stroke-width="2"')
    expect(html).toContain('opacity="0.5"')
    expect(html).not.toContain('style=')
  })

  it('keeps the attribute when the style says something it cannot keep', () => {
    const html = draw(
      '<svg viewBox="0 0 9 9"><rect fill="#fff" style="fill: var(--x, red); stroke: url(https://x/#p); behavior: url(x.htc); : ; broken"/></svg>',
    )

    expect(html).toContain('fill="#fff"')
    for (const dropped of ['var(', 'https://x', 'behavior', 'style=']) {
      expect(html).not.toContain(dropped)
    }
  })

  it('admits a colour per scheme, each half checked as a colour', () => {
    const kept = draw(
      '<svg viewBox="0 0 9 9"><rect style="fill: light-dark(rgb(0, 0, 0), #fff)"/><circle fill="light-dark(white,black)"/></svg>',
    )
    expect(kept).toContain('fill="light-dark(rgb(0, 0, 0), #fff)"')
    expect(kept).toContain('fill="light-dark(white,black)"')

    for (const value of [
      'light-dark(url(#x), #fff)',
      'light-dark(#fff, url(https://x/#p))',
      'light-dark(#fff)',
      'light-dark(var(--a), #fff)',
      'light-dark(#fff, #000, #111)',
    ]) {
      expect(draw(`<svg viewBox="0 0 9 9"><rect fill="${value}"/></svg>`)).not.toContain('fill=')
    }
  })
})
