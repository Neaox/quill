// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { packRanges, TOKEN_HIGHLIGHT_PREFIX } from '@quill/highlight'

import { enhanceReader, type ReaderWindow } from './reader.ts'

/** A public page's article as the renderer emits it: one code block, one diagram. */
function renderPage(): void {
  const tokens = packRanges([
    { start: 0, end: 6, type: 'keyword' },
    { start: 7, end: 13, type: 'function' },
  ])
  document.body.innerHTML = `<main><article>
    <pre><code data-lang="ts" data-tokens="${tokens}">export verify()</code></pre>
    <figure><div class="diagram"><svg aria-label="The flow"></svg></div></figure>
  </article></main>`
}

/** jsdom's window, which has no CSS Custom Highlight API, optionally given one. */
function page(highlights?: Map<string, Set<unknown>>): ReaderWindow {
  const { document, Node, Text, StaticRange } = globalThis
  if (highlights === undefined) return { document, Node, Text }
  return {
    document,
    Node,
    Text,
    StaticRange,
    CSS: { highlights },
    Highlight: Set,
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('enhanceReader', () => {
  it('paints every code block through CSS.highlights, leaving its text node alone', () => {
    renderPage()
    const highlights = new Map<string, Set<unknown>>()

    const dispose = enhanceReader(page(highlights))

    expect(highlights.get(`${TOKEN_HIGHLIGHT_PREFIX}keyword`)?.size).toBe(1)
    expect(highlights.get(`${TOKEN_HIGHLIGHT_PREFIX}function`)?.size).toBe(1)
    expect(document.querySelector('code')?.childNodes).toHaveLength(1)

    dispose()
    expect(highlights.get(`${TOKEN_HIGHLIGHT_PREFIX}keyword`)?.size).toBe(0)
  })

  it('falls back to token spans where the browser cannot paint ranges', () => {
    renderPage()

    enhanceReader(page())

    const code = document.querySelector('code')
    expect(code?.querySelector('.tok-keyword')?.textContent).toBe('export')
    expect(code?.querySelector('.tok-function')?.textContent).toBe('verify')
    expect(code?.textContent).toBe('export verify()')
  })

  it('gives every code block its copy button, named by its language', () => {
    renderPage()

    const dispose = enhanceReader(page())

    expect(document.querySelector('.code-copy')?.getAttribute('aria-label')).toBe(
      'Copy TypeScript code',
    )
    dispose()
    expect(document.querySelector('.code-copy')).toBeNull()
  })

  it('gives every diagram its lightbox, and takes it away again', () => {
    renderPage()

    const dispose = enhanceReader(page())

    expect(document.querySelector('.diagram-expand')?.getAttribute('aria-label')).toBe(
      'Expand diagram: The flow',
    )
    dispose()
    expect(document.querySelector('.diagram-expand')).toBeNull()
  })

  it('gives every table its sort buttons, and takes them away again (ADR-040)', () => {
    document.body.innerHTML = `<main><article><div class="table-block"><div class="table-scroll"><table>
      <thead><tr><th scope="col">Region</th></tr></thead>
      <tbody><tr><td>us</td></tr><tr><td>eu</td></tr></tbody></table></div></div></article></main>`

    const dispose = enhanceReader(page())

    expect(document.querySelector('th > .table-sort')?.textContent).toBe('Region')
    expect(document.querySelector('.table-expand')?.getAttribute('aria-label')).toBe('Expand table')
    dispose()
    expect(document.querySelector('.table-sort')).toBeNull()
    expect(document.querySelector('.table-expand')).toBeNull()
  })

  it('keeps the sticky chrome equal to the site header (ADR-040)', () => {
    document.body.innerHTML =
      '<header class="site-header"></header><main><article></article></main>'

    const dispose = enhanceReader(page())

    expect(document.documentElement.style.getPropertyValue('--sticky-chrome-top')).toBe('0px')
    dispose()
    expect(document.documentElement.style.getPropertyValue('--sticky-chrome-top')).toBe('')
  })

  it('plays an animated emoji briefly, and gives it back as it came (ADR-047)', () => {
    document.body.innerHTML =
      '<main><article><p><picture class="emoji" data-loop-ms="1000">' +
      '<source srcset="/api/emoji/party.bbbbbbbbbbbbbbbb.gif" media="(prefers-reduced-motion: reduce)">' +
      '<img class="emoji" src="/api/emoji/party.aaaaaaaaaaaaaaaa.gif" alt=":party:" width="20" height="20">' +
      '</picture></p></article></main>'

    const dispose = enhanceReader(page())

    expect(document.querySelector('picture')?.hasAttribute('data-state')).toBe(true)
    dispose()
    expect(document.querySelector('picture')?.hasAttribute('data-state')).toBe(false)
  })
})
