import { describe, expect, it } from 'vitest'
import { instrument } from './builtin/instrument.ts'
import { toCss } from './css.ts'
import { generateTheme } from './generate.ts'

const generated = generateTheme(instrument)
const css = toCss(generated)

describe('toCss', () => {
  it('emits the four blocks in the resolution order tokens.css documents', () => {
    const order = [
      ':root {',
      "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {",
      ":root[data-theme='dark'] {",
      ":root[data-theme='light'] {",
    ]
    const positions = order.map((needle) => css.indexOf(needle))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].toSorted((a, b) => a - b))
  })

  it('declares the colour scheme in each block', () => {
    expect(css.match(/color-scheme: light;/gu)).toHaveLength(2)
    expect(css.match(/color-scheme: dark;/gu)).toHaveLength(2)
  })

  it('writes every generated token in the light block', () => {
    for (const [name, value] of Object.entries(generated.light)) {
      expect(css).toContain(`  ${name}: ${value};`)
    }
  })

  it('scopes to a selector when one is given', () => {
    const scoped = toCss(generated, { selector: '.quill-theme' })
    expect(scoped).toContain('.quill-theme {')
    expect(scoped).toContain(".quill-theme:not([data-theme='light'])")
    expect(scoped).toContain(".quill-theme[data-theme='dark']")
    expect(scoped).not.toContain(':root')
  })

  it('is stable: the same generated theme always produces the same CSS', () => {
    expect(toCss(generated)).toBe(css)
    expect(toCss(generateTheme(instrument))).toBe(css)
  })
})
