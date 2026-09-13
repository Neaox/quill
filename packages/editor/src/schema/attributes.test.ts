import { describe, expect, it } from 'vitest'

import { domAttributeName, parseAttribute, renderAttribute } from './attributes.ts'

function element(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  const child = host.firstElementChild
  if (!(child instanceof HTMLElement)) throw new Error('That markup has no element in it.')
  return child
}

describe('an attribute crossing the DOM', () => {
  it('keeps a real HTML attribute under its own name', () => {
    expect(domAttributeName('src')).toBe('src')
    expect(renderAttribute('src', '/a.png')).toEqual({ src: '/a.png' })
  })

  it('writes everything else as a data attribute, kebab-cased', () => {
    expect(domAttributeName('referenceType')).toBe('data-reference-type')
    expect(renderAttribute('referenceType', 'full')).toEqual({ 'data-reference-type': 'full' })
  })

  it('writes nothing for an attribute that is not set', () => {
    expect(renderAttribute('layout', null)).toEqual({})
    expect(renderAttribute('layout', undefined)).toEqual({})
    expect(renderAttribute('synthetic', false)).toEqual({})
  })

  it('writes a structured value as JSON rather than as [object Object]', () => {
    expect(renderAttribute('attributes', { type: 'warning' })).toEqual({
      'data-attributes': '{"type":"warning"}',
    })
  })

  it('reads a structured value back as the value it was', () => {
    expect(
      parseAttribute('attributes', element('<div data-attributes=\'{"a":1}\'></div>')),
    ).toEqual({ a: 1 })
    expect(parseAttribute('align', element('<div data-align=\'["left"]\'></div>'))).toEqual([
      'left',
    ])
  })

  it('reads booleans, numbers, strings and absence back as themselves', () => {
    expect(parseAttribute('synthetic', element('<p data-synthetic="true"></p>'))).toBe(true)
    expect(parseAttribute('synthetic', element('<p data-synthetic="false"></p>'))).toBe(false)
    expect(parseAttribute('level', element('<p data-level="3"></p>'))).toBe(3)
    expect(parseAttribute('language', element('<p data-language="ts"></p>'))).toBe('ts')
    expect(parseAttribute('language', element('<p data-language=""></p>'))).toBe('')
    expect(parseAttribute('layout', element('<p></p>'))).toBeNull()
  })

  it('survives a round trip for every kind of value', () => {
    const values: readonly [string, unknown][] = [
      ['title', 'A title'],
      ['level', 2],
      ['checked', true],
      ['attributes', { type: 'tip' }],
    ]
    for (const [name, value] of values) {
      const rendered = Object.entries(renderAttribute(name, value))
        .map(([key, text]) => `${key}="${text.replaceAll('"', '&quot;')}"`)
        .join(' ')
      expect(parseAttribute(name, element(`<p ${rendered}></p>`))).toEqual(value)
    }
  })
})
