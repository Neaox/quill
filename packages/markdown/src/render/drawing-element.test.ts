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
})
