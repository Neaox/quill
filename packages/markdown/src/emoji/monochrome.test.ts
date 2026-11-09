import { describe, expect, it } from 'vitest'

import { monochromeGlyph } from './monochrome.ts'

const glyph = (source: string) => {
  const read = monochromeGlyph(source)
  if (read.kind !== 'glyph') throw new Error(read.reason)
  return read
}

const refusal = (source: string): string => {
  const read = monochromeGlyph(source)
  return read.kind === 'refused' ? read.reason : 'read as a glyph'
}

/** rookwood's clock, as its documentation site draws it. */
const CLOCK =
  '<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.5"/><path d="M8,4.5 V8 L10.5,9.5"/></svg>'

describe('a monochrome emoji’s glyph (ADR-038, amended)', () => {
  it('is the drawing’s shapes in one symbol, painted with the colour it is used in', () => {
    expect(glyph(CLOCK)).toEqual({
      kind: 'glyph',
      svg: [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">',
        '<symbol id="glyph" viewBox="0 0 16 16">',
        '<g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">',
        '<circle cx="8" cy="8" r="6.5"/><path d="M8,4.5 V8 L10.5,9.5"/>',
        '</g></symbol><use href="#glyph"/></svg>',
      ].join(''),
      width: 16,
      height: 16,
    })
  })

  it('takes one colour however it is spelled as the colour, and fills with it by default', () => {
    expect(
      glyph(
        '<?xml version="1.0"?><svg viewBox="0 0 24 12"><path fill="#000" d="M1 1h4"/><rect x="1" y="1" width="2" height="2" stroke="BLACK" fill="#000000"/><g><line x1="0" y1="0" x2="1" y2="1" stroke="#000"/></g></svg>',
      ).svg,
    ).toBe(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" width="24" height="12">',
        '<symbol id="glyph" viewBox="0 0 24 12"><g fill="currentColor">',
        '<path fill="currentColor" d="M1 1h4"/>',
        '<rect x="1" y="1" width="2" height="2" stroke="currentColor" fill="currentColor"/>',
        '<g><line x1="0" y1="0" x2="1" y2="1" stroke="currentColor"/></g>',
        '</g></symbol><use href="#glyph"/></svg>',
      ].join(''),
    )
  })

  it('keeps none and the context’s own colour as they are, whatever else is there', () => {
    expect(
      glyph(
        '<svg viewBox="0 0 8 8"><path d="M0 0" fill="transparent" stroke="inherit"/><path d="M1 1" fill="#123456"/></svg>',
      ).svg,
    ).toContain(
      '<path d="M0 0" fill="none" stroke="currentColor"/><path d="M1 1" fill="currentColor"/>',
    )
  })

  it('is laid out in a view box made from its width and height when it has none, rounded to whole pixels', () => {
    const read = glyph(
      '<svg width="20.4" height="10"><path d="M1 1" transform="rotate(45 5 5)"/></svg>',
    )
    expect(read.svg).toContain('viewBox="0 0 20.4 10"')
    expect(read.svg).toContain('<path d="M1 1" transform="rotate(45 5 5)"/>')
    expect([read.width, read.height]).toEqual([20, 10])
  })

  it('drops what is not part of the drawing, and every attribute that is not geometry or a plain stroke', () => {
    expect(
      glyph(
        '<svg viewBox="0 0 8 8" id="logo" class="a"><title>Clock</title><desc>A clock</desc><metadata>x</metadata><path id="p" class="q" onclick="alert(1)" data-x="1" d="M1 1" opacity="0.5" fill-rule="evenodd"/></svg>',
      ).svg,
    ).toContain('<g fill="currentColor"><path d="M1 1" opacity="0.5" fill-rule="evenodd"/></g>')
  })

  it('refuses a drawing in two colours, which is a picture', () => {
    expect(
      refusal(
        '<svg viewBox="0 0 8 8"><path fill="#f00" d="M1 1"/><path fill="#00f" d="M1 1"/></svg>',
      ),
    ).toBe('it is drawn in more than one colour')
  })

  it('refuses anything that draws other than shapes, by name', () => {
    expect(refusal('<svg viewBox="0 0 8 8"><text>a</text></svg>')).toBe(
      'it holds <text>, and a glyph holds shapes only',
    )
    expect(refusal('<svg viewBox="0 0 8 8"><script>alert(1)</script></svg>')).toBe(
      'it holds <script>, and a glyph holds shapes only',
    )
    expect(refusal('<svg viewBox="0 0 8 8"><image href="x.png"/></svg>')).toBe(
      'it holds <image>, and a glyph holds shapes only',
    )
    expect(refusal('<svg viewBox="0 0 8 8"><use href="#a"/></svg>')).toBe(
      'it holds <use>, and a glyph holds shapes only',
    )
    expect(
      refusal('<svg viewBox="0 0 8 8"><style>path{fill:red}</style><path d="M1 1"/></svg>'),
    ).toBe('it holds <style>, and a glyph holds shapes only')
  })

  it('refuses paint it cannot hold, a style attribute, and values that are not plain', () => {
    expect(refusal('<svg viewBox="0 0 8 8"><path fill="url(#g)" d="M1 1"/></svg>')).toBe(
      'it is painted with a gradient or a pattern',
    )
    expect(refusal('<svg viewBox="0 0 8 8"><path style="fill:red" d="M1 1"/></svg>')).toBe(
      'it is styled with a style attribute; write its colours as attributes',
    )
    expect(refusal('<svg viewBox="0 0 8 8"><path d="M1 1 javascript:x"/></svg>')).toBe(
      'its d "M1 1 javascript:x" is not plain numbers',
    )
    expect(refusal('<svg viewBox="0 0 8 8"><rect width="calc(1px)"/></svg>')).toBe(
      'its width "calc(1px)" is not plain numbers',
    )
  })

  it('refuses what is not one drawing, has no size, or draws nothing', () => {
    expect(refusal('<p>not a drawing</p>')).toBe('it is not one SVG drawing')
    expect(refusal('<svg viewBox="0 0 8 8"></svg><svg viewBox="0 0 8 8"></svg>')).toBe(
      'it is not one SVG drawing',
    )
    expect(refusal('<svg><path d="M1 1"/></svg>')).toBe(
      'it has no view box to draw it at text size',
    )
    expect(refusal('<svg viewBox="0 0 0 8"><path d="M1 1"/></svg>')).toBe(
      'it has no view box to draw it at text size',
    )
    expect(refusal('<svg viewBox="0 0 8 8"><title>Empty</title></svg>')).toBe('it draws nothing')
  })
})
