// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { targetOwnsKey } from './key-owner.ts'

function within(html: string, selector: string): Element {
  document.body.innerHTML = html
  const found = document.querySelector(selector)
  if (found === null) throw new Error(`No ${selector}.`)
  return found
}

describe('whose a key is, in a presentation', () => {
  it('is the presentation’s when nothing in particular has the focus', () => {
    expect(targetOwnsKey(document.body, ' ')).toBe(false)
    expect(targetOwnsKey(null, 'ArrowRight')).toBe(false)
  })

  it('is the viewer’s, every key of it, inside a dialog: Escape closes it and the arrows pan', () => {
    const inside = within('<dialog open><div class="stage"></div></dialog>', '.stage')

    for (const key of ['Escape', 'ArrowRight', ' ', 'Enter', '+']) {
      expect(targetOwnsKey(inside, key)).toBe(true)
    }
  })

  it.each(['button', 'a[href]', 'summary', 'input', '[role="button"]'])(
    'is a %s’s own for Space and Enter, which press it, rather than the next slide',
    (selector) => {
      const html = [
        '<button class="x">b</button>',
        '<a class="x" href="/y">a</a>',
        '<details><summary class="x">s</summary></details>',
        '<input class="x">',
        '<img class="x" role="button" alt="i">',
      ].join('')
      const target = within(
        html,
        selector === 'a[href]' ? 'a' : selector === '[role="button"]' ? 'img' : selector,
      )

      expect(targetOwnsKey(target, ' ')).toBe(true)
      expect(targetOwnsKey(target, 'Enter')).toBe(true)
    },
  )

  it('leaves the arrows and the rest to the presentation, even with a button focused', () => {
    const button = within('<button>b</button>', 'button')

    expect(targetOwnsKey(button, 'ArrowRight')).toBe(false)
    expect(targetOwnsKey(button, 'PageDown')).toBe(false)
    expect(targetOwnsKey(button, 'b')).toBe(false)
  })
})
