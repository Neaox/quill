import { fromHtml } from 'hast-util-from-html'
import { sanitize } from 'hast-util-sanitize'
import { visit } from 'unist-util-visit'
import { describe, expect, it } from 'vitest'
import type { Element, Properties } from 'hast'

import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from './html.ts'
import { sanitizeSchema } from './sanitize-schema.ts'

const render = (markdown: string): string => renderHtml(parseMarkdown(markdown))

/**
 * One element through the document sanitiser, as the renderer's output would
 * go: inside a table, where the sanitiser only admits table parts.
 */
function sanitized(tagName: string, properties: Properties): Properties {
  const target: Element = { type: 'element', tagName, properties, children: [] }
  const tree: Element =
    tagName === 'table' || tagName === 'div' || tagName === 'col'
      ? target
      : { type: 'element', tagName: 'table', properties: {}, children: [target] }
  const root = sanitize({ type: 'root', children: [tree] }, sanitizeSchema)
  let found: Properties = {}
  visit(root, 'element', (node: Element) => {
    if (node.tagName === tagName) found = node.properties
  })
  return found
}

/** Every element of a rendered body, parsed back as a browser would. */
function elementsOf(html: string): Element[] {
  const elements: Element[] = []
  visit(fromHtml(html, { fragment: true }), 'element', (node: Element) => {
    elements.push(node)
  })
  return elements
}

/**
 * ADR-040's additions to the allowlist, attacked. Every value the table block
 * carries is enumerated or patterned, so the only values that survive are the
 * ones the renderer itself produces.
 */
describe('table blocks: adversarial values', () => {
  it('admits only the options the renderer can produce', () => {
    expect(
      sanitized('div', {
        className: ['table-block'],
        'data-width': 'percent',
        'data-percent': '55',
        'data-freeze': 'header first-column',
        'data-responsive': 'stack',
        'data-sort': 'off',
      }),
    ).toEqual({
      className: ['table-block'],
      'data-width': 'percent',
      'data-percent': '55',
      'data-freeze': 'header first-column',
      'data-responsive': 'stack',
      'data-sort': 'off',
    })

    expect(
      sanitized('div', {
        'data-width': 'calc(100vw)',
        'data-percent': '57',
        'data-freeze': 'first-column header',
        'data-responsive': 'cards',
        'data-sort': 'on',
      }),
    ).toEqual({})
  })

  it('admits a column width, roles that restate the implicit ones, and nothing else', () => {
    expect(sanitized('col', { width: '33.33%', span: 2, onClick: 'x' })).toEqual({
      width: '33.33%',
      span: 2,
    })
    expect(sanitized('td', { role: 'button' })).toEqual({})
    expect(sanitized('table', { role: 'presentation' })).toEqual({})
    expect(sanitized('tr', { role: 'row' })).toEqual({ role: 'row' })
  })

  it('refuses a stacked label on more than one line, or longer than a header is cut to', () => {
    expect(sanitized('td', { 'data-label': 'Owner' })).toEqual({ 'data-label': 'Owner' })
    expect(sanitized('td', { 'data-label': 'a\nb' })).toEqual({})
    expect(sanitized('td', { 'data-label': 'A'.repeat(81) })).toEqual({})
  })

  it('carries hostile header text into a stacked label only as escaped text', () => {
    const html = render(
      ':::table{responsive=stack}\n| x" onmouseover="alert(1) <img src=x onerror=alert(1)> |\n| - |\n| 1 |\n:::\n',
    )

    const elements = elementsOf(html)
    expect(elements.some((each) => each.tagName === 'img')).toBe(false)
    expect(elements.some((each) => Object.hasOwn(each.properties, 'onMouseOver'))).toBe(false)
    expect(html).toContain('data-label="x&#x22; onmouseover=&#x22;alert(1)')
  })

  it('cannot be given an option value from an attribute it does not read', () => {
    const html = render(
      ':::table{width="full onmouseover=alert(1)" data-width=full class=evil #main}\n| a |\n| - |\n| 1 |\n:::\n',
    )

    expect(html).toContain('<div class="table-block"><div class="table-scroll"')
    expect(html).not.toContain('evil')
    expect(html).not.toContain('onmouseover')
    expect(html).not.toContain('id="main"')
  })
})

describe('row headers, footers and captions: adversarial values', () => {
  it('admits only the header kinds, the caption side and the frozen parts the renderer emits', () => {
    expect(
      sanitized('div', {
        'data-headers': 'both',
        'data-caption': 'bottom',
        'data-freeze': 'header first-column footer',
      }),
    ).toEqual({
      'data-headers': 'both',
      'data-caption': 'bottom',
      'data-freeze': 'header first-column footer',
    })
    expect(
      sanitized('div', {
        'data-headers': 'column',
        'data-caption': 'top',
        'data-freeze': 'footer header',
      }),
    ).toEqual({})
  })

  it('names a scroll region only by a caption id, which it prefixes', () => {
    expect(sanitized('div', { ariaLabelledBy: ['caption.1'] })).toEqual({
      ariaLabelledBy: ['user-content-caption.1'],
    })
    // A refused reference is dropped from the list, so it can name nothing.
    expect(sanitized('div', { ariaLabelledBy: ['main'] })).toEqual({ ariaLabelledBy: [] })
    expect(sanitized('caption', { id: 'caption.1' })).toEqual({ id: 'user-content-caption.1' })
    expect(sanitized('caption', { id: 'main' })).toEqual({ id: 'user-content-main' })
  })

  it('admits the row header and footer roles, and no other', () => {
    expect(sanitized('th', { role: 'rowheader' })).toEqual({ role: 'rowheader' })
    expect(sanitized('tfoot', { role: 'rowgroup' })).toEqual({ role: 'rowgroup' })
    expect(sanitized('tfoot', { role: 'button' })).toEqual({})
  })

  it('carries a hostile caption only as text, and names the region by id, never by its words', () => {
    const html = render(
      ':::table[<img src=x onerror=alert(1)> "quoted"]\n| a |\n| - |\n| 1 |\n:::\n',
    )
    const elements = elementsOf(html)

    expect(elements.some((each) => each.tagName === 'img')).toBe(false)
    expect(html).toContain('aria-labelledby="user-content-caption.1"')
    expect(html).not.toContain('aria-label="')
  })
})
