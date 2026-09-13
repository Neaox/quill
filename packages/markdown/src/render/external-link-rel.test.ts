import { describe, expect, it } from 'vitest'
import type { Element, Root as HastRoot } from 'hast'

import { addExternalLinkRel } from './external-link-rel.ts'

function anchor(properties: Element['properties']): Element {
  return { type: 'element', tagName: 'a', properties, children: [] }
}

// Exercised end to end through `renderHtml` for the common cases (external and
// relative links; see `render.test.ts`). These unit tests cover the shapes that
// path never produces on its own: an anchor with no `href` at all, one that
// already carries a `rel`, a non-anchor element, and a root-level node with no
// element wrapper.
describe('addExternalLinkRel', () => {
  it('does nothing to a non-anchor element', () => {
    const root: HastRoot = {
      type: 'root',
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [] }],
    }

    expect(addExternalLinkRel(root)).toEqual(root)
  })

  it('does nothing to an anchor with no href', () => {
    const root: HastRoot = { type: 'root', children: [anchor({})] }

    expect(addExternalLinkRel(root)).toEqual(root)
  })

  it('does nothing to an anchor whose href is relative', () => {
    const root: HastRoot = { type: 'root', children: [anchor({ href: './other.md' })] }

    expect(addExternalLinkRel(root)).toEqual(root)
  })

  it('leaves an existing rel alone rather than overwriting it', () => {
    const root: HastRoot = {
      type: 'root',
      children: [anchor({ href: 'https://example.com', rel: ['author'] })],
    }

    expect(addExternalLinkRel(root)).toEqual(root)
  })

  it('adds rel="noopener noreferrer" to an external anchor at the root', () => {
    const root: HastRoot = { type: 'root', children: [anchor({ href: 'https://example.com' })] }

    expect(addExternalLinkRel(root)).toEqual({
      type: 'root',
      children: [anchor({ href: 'https://example.com', rel: ['noopener', 'noreferrer'] })],
    })
  })

  it('leaves a root-level non-element node untouched', () => {
    const root: HastRoot = { type: 'root', children: [{ type: 'text', value: 'hi' }] }

    expect(addExternalLinkRel(root)).toEqual(root)
  })

  it('recurses into nested elements to find the anchor', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [anchor({ href: 'https://example.com' })],
        },
      ],
    }

    const result = addExternalLinkRel(root)

    expect(result).toEqual({
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: [anchor({ href: 'https://example.com', rel: ['noopener', 'noreferrer'] })],
        },
      ],
    })
  })
})
