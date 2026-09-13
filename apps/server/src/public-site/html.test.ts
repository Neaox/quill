import { describe, expect, it } from 'vitest'

import { EMPTY_HTML, escapeHtml, html, raw, toDocument } from './html.ts'

/**
 * The public site is the one surface where an escaping mistake is a stored
 * cross-site script on a page nobody has to sign in to reach, so the tag that
 * builds every page is tested on its own.
 */

describe('escapeHtml', () => {
  it('escapes everything that can end an element or an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    )
  })

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Rate limits — 100 a minute')).toBe('Rate limits — 100 a minute')
  })
})

describe('the html tag', () => {
  it('escapes an interpolated string', () => {
    expect(html`<h1>${'<script>alert(1)</script>'}</h1>`.value).toBe(
      '<h1>&lt;script&gt;alert(1)&lt;/script&gt;</h1>',
    )
  })

  it('escapes inside a quoted attribute', () => {
    expect(html`<a href="${'" onclick="alert(1)'}">x</a>`.value).toBe(
      '<a href="&quot; onclick=&quot;alert(1)">x</a>',
    )
  })

  it('keeps a number, and drops nothing, null, undefined and false', () => {
    expect(html`${1}${null}${undefined}${false}${''}`.value).toBe('1')
  })

  it('emits marked HTML as it stands', () => {
    expect(html`<main>${raw('<article>body</article>')}</main>`.value).toBe(
      '<main><article>body</article></main>',
    )
  })

  it('joins a list, escaping each entry', () => {
    expect(html`${['a', raw('<b>'), '<c>']}`.value).toBe('a<b>&lt;c&gt;')
  })

  it('joins a nested list', () => {
    expect(html`${[['a', 'b'], ['c']]}`.value).toBe('abc')
  })

  it('has an empty value nothing has to reinvent', () => {
    expect(EMPTY_HTML.value).toBe('')
  })
})

describe('toDocument', () => {
  it('puts the doctype in front of the page, and trims the source’s own whitespace', () => {
    expect(toDocument(html` <html></html> `)).toBe('<!doctype html>\n<html></html>\n')
  })
})
