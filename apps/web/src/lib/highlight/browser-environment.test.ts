import { describe, expect, it } from 'vitest'

import { applyHighlighting } from '@quill/highlight/client'
import { packRanges, TOKEN_HIGHLIGHT_PREFIX, type TokenRange } from '@quill/highlight'

import { createBrowserHighlighting, type HighlightWindow } from './browser-environment.ts'

const RANGES: readonly TokenRange[] = [
  { start: 0, end: 6, type: 'keyword' },
  { start: 7, end: 12, type: 'function' },
]

/** A rendered code block as the Markdown pipeline emits it (ADR-030). */
function renderBody(): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = `<pre><code data-lang="ts" data-tokens="${packRanges(RANGES)}">export verify</code></pre>`
  document.body.append(article)
  return article
}

/** The real window, minus the CSS Custom Highlight API. */
function windowWithout(
  capabilities: Partial<Pick<HighlightWindow, 'CSS' | 'Highlight' | 'StaticRange'>>,
): HighlightWindow {
  return {
    document: globalThis.document,
    Node: globalThis.Node,
    Text: globalThis.Text,
    ...capabilities,
  }
}

class FakeHighlight {
  readonly ranges = new Set<unknown>()
  add(range: unknown) {
    this.ranges.add(range)
  }
  delete(range: unknown) {
    this.ranges.delete(range)
  }
}

describe('createBrowserHighlighting', () => {
  it('paints ranges through CSS.highlights when the browser has the API', () => {
    const highlights = new Map<string, FakeHighlight>()
    const view = windowWithout({
      CSS: { highlights },
      Highlight: FakeHighlight,
      StaticRange: globalThis.StaticRange,
    })
    const { environment, rootOf } = createBrowserHighlighting(view)
    const article = renderBody()

    const disposers = applyHighlighting(rootOf(article), environment)

    // One highlight per token class, each holding the block's ranges, and the
    // code itself left as the single text node it arrived as.
    expect(highlights.get(`${TOKEN_HIGHLIGHT_PREFIX}keyword`)?.ranges.size).toBe(1)
    expect(highlights.get(`${TOKEN_HIGHLIGHT_PREFIX}function`)?.ranges.size).toBe(1)
    expect(article.querySelector('code')?.childNodes).toHaveLength(1)

    for (const dispose of disposers) dispose()
    expect(highlights.get(`${TOKEN_HIGHLIGHT_PREFIX}keyword`)?.ranges.size).toBe(0)
  })

  it('builds a live Range where StaticRange is missing', () => {
    const highlights = new Map<string, FakeHighlight>()
    const view = windowWithout({ CSS: { highlights }, Highlight: FakeHighlight })
    const { environment, rootOf } = createBrowserHighlighting(view)

    applyHighlighting(rootOf(renderBody()), environment)

    const painted = [...(highlights.get(`${TOKEN_HIGHLIGHT_PREFIX}keyword`)?.ranges ?? [])]
    expect(painted[0]).toBeInstanceOf(Range)
  })

  it('falls back to markup spans in a browser without CSS.highlights', () => {
    const { environment, rootOf } = createBrowserHighlighting(windowWithout({}))
    const article = renderBody()

    applyHighlighting(rootOf(article), environment)

    const code = article.querySelector('code')
    expect(code?.querySelector('.tok-keyword')?.textContent).toBe('export')
    expect(code?.querySelector('.tok-function')?.textContent).toBe('verif')
    // The text is unchanged; only its presentation is.
    expect(code?.textContent).toBe('export verify')
  })

  it('refuses a node that is not a real text node rather than corrupting the page', () => {
    const { environment } = createBrowserHighlighting(windowWithout({}))

    expect(() => environment.createRange({ data: 'export' }, 0, 6)).toThrow(TypeError)
  })

  it('leaves a block with no packed ranges alone', () => {
    const article = document.createElement('article')
    article.innerHTML = '<pre><code data-lang="ts">export verify</code></pre>'
    const { environment, rootOf } = createBrowserHighlighting(windowWithout({}))

    expect(applyHighlighting(rootOf(article), environment)).toEqual([])
    expect(article.querySelector('code')?.innerHTML).toBe('export verify')
  })
})
