import { toHtml } from 'hast-util-to-html'
import { describe, expect, it } from 'vitest'

import { drawingElement } from './drawing-element.ts'

const placement = { url: '/api/attachments/a', idPrefix: 'user-content-d1-', label: 'Flow' }

const html = (element: ReturnType<typeof drawingElement>): string =>
  element === null ? '<none>' : toHtml(element, { space: 'svg' })

describe('drawingElement', () => {
  it('draws an inline drawing through the allowlist, with its granted data', () => {
    expect(
      html(
        drawingElement(
          {
            kind: 'inline',
            markup: '<svg viewBox="0 0 40 20"><rect/></svg>',
            naturalSize: true,
            data: { 'data-x': 'y' },
          },
          placement,
        ),
      ),
    ).toBe(
      '<svg viewBox="0 0 40 20" role="img" aria-label="Flow" width="40" height="20" data-x="y"><rect></rect></svg>',
    )
  })

  it('leaves a drawing without a usable view box at the measure', () => {
    expect(
      html(
        drawingElement(
          { kind: 'inline', markup: '<svg><rect/></svg>', naturalSize: true, data: {} },
          placement,
        ),
      ),
    ).toBe('<svg role="img" aria-label="Flow"><rect></rect></svg>')
    expect(
      html(
        drawingElement(
          { kind: 'inline', markup: '<svg viewBox="0 0 0 -1"/>', naturalSize: true, data: {} },
          placement,
        ),
      ),
    ).not.toContain('width=')
  })

  it('places nothing for markup that is not a drawing', () => {
    expect(
      drawingElement({ kind: 'inline', markup: '<p/>', naturalSize: false, data: {} }, placement),
    ).toBeNull()
  })

  it('shows an image of the stored file, and only from this origin', () => {
    expect(html(drawingElement({ kind: 'image', data: {} }, placement))).toBe(
      '<img src="/api/attachments/a" alt="Flow" loading="lazy" decoding="async"></img>',
    )
    for (const url of ['//evil.example/a', '/\\evil.example', 'javascript:alert(1)', 'a.svg']) {
      expect(drawingElement({ kind: 'image', data: {} }, { ...placement, url })).toBeNull()
    }
  })

  it('keeps only data attributes from a rendering, and none that override the platform', () => {
    const hostile = {
      'data-drawio': 'fixed',
      src: 'https://evil.example/x.svg',
      onload: 'alert(1)',
      role: 'presentation',
      'aria-label': 'Something else',
      'data-Bad': 'x',
    }
    const image = html(drawingElement({ kind: 'image', data: hostile }, placement))
    const inline = html(
      drawingElement(
        { kind: 'inline', markup: '<svg><rect/></svg>', naturalSize: false, data: hostile },
        placement,
      ),
    )

    for (const drawn of [image, inline]) {
      expect(drawn).toContain('data-drawio="fixed"')
      for (const absent of [
        'evil.example',
        'onload',
        'presentation',
        'Something else',
        'data-Bad',
      ]) {
        expect(drawn).not.toContain(absent)
      }
    }
    expect(image).toContain('src="/api/attachments/a"')
    expect(inline).toContain('role="img" aria-label="Flow"')
  })

  it("keeps the organisation's label classes in an inline drawing", () => {
    expect(
      html(
        drawingElement(
          {
            kind: 'inline',
            markup: '<svg><rect class="acme fixed"/></svg>',
            naturalSize: false,
            data: {},
          },
          { ...placement, labels: new Set(['acme']) },
        ),
      ),
    ).toContain('<rect class="acme">')
  })
})
