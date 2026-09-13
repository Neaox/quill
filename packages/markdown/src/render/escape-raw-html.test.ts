import { describe, expect, it } from 'vitest'
import type { Root as HastRoot } from 'hast'

import { escapeRawHtml } from './escape-raw-html.ts'

// `escapeRawHtml` is exercised end to end through `renderHtml` (see
// `render.security.test.ts`), where a `raw` node is always nested inside the
// `<article>` element `html.ts` builds. These unit tests cover the shapes that
// combination never produces on its own: a `raw`, `text`, or `comment` node
// sitting directly at the root, so both the element-recursion and the
// root-level passthrough branches are proven independently of that wrapping.
describe('escapeRawHtml', () => {
  it('turns a root-level raw node into text', () => {
    const root = {
      type: 'root',
      children: [{ type: 'raw', value: '<script>alert(1)</script>' }],
    } as unknown as HastRoot

    expect(escapeRawHtml(root)).toEqual({
      type: 'root',
      children: [{ type: 'text', value: '<script>alert(1)</script>' }],
    })
  })

  it('leaves a root-level non-element node untouched', () => {
    const root: HastRoot = {
      type: 'root',
      children: [{ type: 'text', value: 'hello' }],
    }

    expect(escapeRawHtml(root)).toEqual(root)
  })

  it('recurses into nested elements, escaping a raw node wherever it sits', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            { type: 'text', value: 'before ' },
            // Not part of the `hast` `ElementContent` union, but exactly what
            // `mdast-util-to-hast` produces in dangerous mode (see `html.ts`).
            { type: 'raw', value: '<b>x</b>' } as never,
            { type: 'text', value: ' after' },
          ],
        },
      ],
    }

    expect(escapeRawHtml(root)).toEqual({
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [
            { type: 'text', value: 'before ' },
            { type: 'text', value: '<b>x</b>' },
            { type: 'text', value: ' after' },
          ],
        },
      ],
    })
  })

  it('leaves an element with no raw descendants unchanged', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'x' }] },
      ],
    }

    expect(escapeRawHtml(root)).toEqual(root)
  })
})
