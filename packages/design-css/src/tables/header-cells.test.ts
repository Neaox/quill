// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { styleSheetPath } from '../index.ts'

/**
 * The two kinds of header cell (ADR-040) share their surface and never their
 * type: a row header names its row in the ink at the body's weight and more,
 * a column header is a quiet label. Pinned against the real stylesheet, in
 * every `rules` treatment and in both schemes, so the two cannot drift into
 * each other's job again.
 */

const RULES = ['hairline', 'double', 'cards', 'plain'] as const
const SCHEMES = ['light', 'dark'] as const

beforeAll(() => {
  const sheet = document.createElement('style')
  sheet.textContent = readFileSync(styleSheetPath('prose.css'), 'utf8')
  document.head.append(sheet)
})

afterEach(() => {
  document.body.replaceChildren()
})

function table(rules: string, scheme: string): HTMLElement {
  document.documentElement.dataset['scheme'] = scheme
  document.body.innerHTML = `<article class="prose" data-rules="${rules}">
<div class="table-block" data-headers="both"><div class="table-scroll"><table>
<thead><tr><th scope="col">Region</th><th scope="col">Budget</th></tr></thead>
<tbody><tr><th scope="row">eu-west-1</th><td>120 ms</td></tr></tbody>
</table></div></div></article>`
  const article = document.querySelector<HTMLElement>('article')
  if (article === null) throw new Error('no article')
  return article
}

function style(selector: string): CSSStyleDeclaration {
  const element = document.querySelector(selector)
  if (element === null) throw new Error(`no ${selector}`)
  return getComputedStyle(element)
}

describe('header cells', () => {
  for (const rules of RULES) {
    for (const scheme of SCHEMES) {
      it(`keeps a row header in the ink and bold, and a column header quiet (${rules}, ${scheme})`, () => {
        table(rules, scheme)
        const rowHeader = style('tbody th[scope="row"]')
        const cell = style('tbody td')
        const columnHeader = style('thead th')

        expect(rowHeader.fontWeight).toBe('600')
        expect(cell.fontWeight).not.toBe(rowHeader.fontWeight)
        expect(cell.color).not.toBe('var(--color-muted)')
        expect(rowHeader.color).toBe('var(--color-foreground)')
        expect(columnHeader.color).toBe('var(--color-muted)')
        expect(columnHeader.fontWeight).toBe('var(--table-header-weight)')
        // The surface is shared: one tint for both kinds.
        expect(rowHeader.backgroundColor).toBe('var(--table-header-bg)')
        expect(columnHeader.backgroundColor).toBe('var(--table-header-bg)')
      })
    }
  }
})
