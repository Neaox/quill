// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChoiceStorage } from './code-blocks.ts'
import { CHOICES_KEY, enhanceCodeBlocks } from './code-blocks.ts'
import type { ClipboardWriter } from './copy.ts'

/** A group as the renderer emits it (`@quill/markdown`, `code-group/render.ts`). */
function group(labels: readonly string[], sync?: string, title?: string): string {
  const panels = labels.map(
    (label, index) =>
      `<figure class="code-block"><figcaption class="code-caption"><span class="code-label">${label}</span>${
        index === 0 && title !== undefined ? `<span class="code-title">${title}</span>` : ''
      }</figcaption><pre><code data-lang="${label.toLowerCase()}">${label} code</code></pre></figure>`,
  )
  return `<div class="code-group"${sync === undefined ? '' : ` data-sync="${sync}"`}>${panels.join('')}</div>`
}

function page(html: string): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = html
  document.body.append(article)
  return article
}

function memory(initial: Record<string, string> = {}): ChoiceStorage & { saved(): unknown } {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    saved: () => JSON.parse(store.get(CHOICES_KEY) ?? 'null'),
  }
}

const labels: Record<string, string> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  python: 'Python',
}
const languageLabel = (language: string): string | undefined => labels[language]

function tabsOf(element: Element): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>('[role="tab"]')]
}

function selected(element: Element): string | undefined {
  return tabsOf(element).find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent
}

function press(target: Element, name: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
}

/** Gives an element the place and width jsdom cannot lay out. */
function sizes(element: HTMLElement, left: number, width: number): void {
  Object.defineProperty(element, 'offsetLeft', { configurable: true, value: left })
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: width })
}

afterEach(() => {
  document.body.replaceChildren()
  document.getSelection()?.removeAllRanges()
})

describe('copy buttons', () => {
  it('gives every block exactly one, however deeply it is nested', () => {
    const article = page(
      [
        '<div class="code-block"><pre><code data-lang="ts">top</code></pre></div>',
        '<aside class="callout"><div class="code-block"><pre><code>callout</code></pre></div></aside>',
        '<ul><li><div class="code-block"><pre><code>list</code></pre></div></li></ul>',
        '<table><tbody><tr><td><div class="code-block"><pre><code>cell</code></pre></div></td></tr></tbody></table>',
        '<div class="cards"><section class="card"><div class="code-block"><pre><code>card</code></pre></div></section></div>',
        '<details><summary>More</summary><div class="code-block"><pre><code>details</code></pre></div></details>',
        '<div class="diagram" data-diagram="mermaid"><pre><code data-lang="mermaid">graph TD</code></pre></div>',
        '<figure><div class="diagram" data-diagram="svg"><svg></svg></div></figure>',
        '<pre><code>bare</code></pre>',
      ].join(''),
    )

    const dispose = enhanceCodeBlocks(article, { languageLabel, storage: memory() })
    enhanceCodeBlocks(article, { languageLabel, storage: memory() })

    const pres = [...article.querySelectorAll('pre')]
    expect(pres).toHaveLength(8)
    for (const pre of pres) {
      expect(pre.parentElement?.querySelectorAll(':scope > .code-copy')).toHaveLength(1)
    }
    expect(article.querySelector('.code-copy')?.getAttribute('aria-label')).toBe(
      'Copy TypeScript code',
    )
    // A block from before cards is given one, for its button's corner.
    expect(article.lastElementChild?.className).toBe('code-block')

    dispose()
    expect(article.querySelectorAll('.code-copy')).toHaveLength(0)
    expect(article.lastElementChild?.tagName).toBe('PRE')
  })

  it('names an unknown language by its tag, and a block with none plainly', () => {
    const article = page(
      '<div class="code-block"><pre><code data-lang="cobol">x</code></pre></div><div class="code-block"><pre>y</pre></div>',
    )
    enhanceCodeBlocks(article, { storage: null })
    expect(
      [...article.querySelectorAll('.code-copy')].map((each) => each.getAttribute('aria-label')),
    ).toEqual(['Copy cobol code', 'Copy code'])
  })

  it('offers a selection made inside a block, and the whole block again after', async () => {
    const article = page(
      '<div class="code-block"><pre><code>one two</code></pre></div><p>after</p>',
    )
    enhanceCodeBlocks(article, { storage: null })
    const button = article.querySelector('.code-copy')
    const text = article.querySelector('code')?.firstChild
    const after = article.querySelector('p')?.firstChild
    if (text === null || text === undefined || after === null || after === undefined) {
      throw new Error('no text')
    }
    const selection = document.getSelection()
    const range = document.createRange()

    range.setStart(text, 0)
    range.setEnd(text, 3)
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await vi.waitFor(() => {
      expect(button?.getAttribute('aria-label')).toBe('Copy selection')
    })

    range.setEnd(after, 2)
    document.dispatchEvent(new Event('selectionchange'))
    await vi.waitFor(() => {
      expect(button?.getAttribute('aria-label')).toBe('Copy code')
    })
  })
})

describe('code groups', () => {
  it('become a tablist whose tabs control their panels', () => {
    const article = page(group(['TypeScript', 'Python', 'curl'], undefined, 'client.ts'))
    enhanceCodeBlocks(article, { languageLabel, storage: memory() })

    const element = article.querySelector('.code-group')
    if (element === null) throw new Error('no group')
    const tablist = element.querySelector('[role="tablist"]')
    expect(tablist?.getAttribute('aria-label')).toBe('Code examples')
    const tabs = tabsOf(element)
    const panels = [...element.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
    expect(tabs.map((tab) => tab.textContent)).toEqual(['TypeScript', 'Python', 'curl'])
    tabs.forEach((tab, index) => {
      const panel = panels[index]
      expect(tab.getAttribute('aria-controls')).toBe(panel?.id)
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id)
    })
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true])
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1])
    // A caption that only named the tab goes; one that names a file stays.
    expect(panels.map((panel) => panel.querySelector('figcaption')?.hidden)).toEqual([
      false,
      true,
      true,
    ])
    // One button, in the header, copying the panel on show.
    expect(element.querySelectorAll('.code-copy')).toHaveLength(1)
    expect(
      element.querySelector('.code-group-header > .code-copy')?.getAttribute('aria-label'),
    ).toBe('Copy TypeScript code')
  })

  it('moves by arrow keys, Home and End, wrapping, with one tab stop', () => {
    const article = page(group(['TypeScript', 'Python', 'curl']))
    enhanceCodeBlocks(article, { languageLabel, storage: memory() })
    const element = article.querySelector('.code-group')
    if (element === null) throw new Error('no group')
    const [first] = tabsOf(element)
    if (first === undefined) throw new Error('no tab')

    press(first, 'ArrowRight')
    expect(selected(element)).toBe('Python')
    expect(document.activeElement?.textContent).toBe('Python')
    expect(element.querySelector('.code-copy')?.getAttribute('aria-label')).toBe('Copy Python code')
    press(first, 'End')
    expect(selected(element)).toBe('curl')
    press(first, 'ArrowRight')
    expect(selected(element)).toBe('TypeScript')
    press(first, 'ArrowLeft')
    expect(selected(element)).toBe('curl')
    press(first, 'Home')
    expect(selected(element)).toBe('TypeScript')
    press(first, 'a')
    expect(selected(element)).toBe('TypeScript')
    expect(tabsOf(element).map((tab) => tab.tabIndex)).toEqual([0, -1, -1])
  })

  it('copies the panel on show', async () => {
    const article = page(group(['TypeScript', 'Python']))
    const written: string[] = []
    const clipboard: ClipboardWriter = {
      writeText: async (text) => {
        written.push(text)
      },
    }
    enhanceCodeBlocks(article, { storage: memory(), clipboard })
    tabsOf(article)[1]?.click()
    article.querySelector<HTMLButtonElement>('.code-copy')?.click()
    await vi.waitFor(() => {
      expect(written).toEqual(['Python code'])
    })
  })

  it('shares a choice with every group on the page that has it, and remembers it', () => {
    const storage = memory()
    const article = page(
      [
        group(['TypeScript', 'Python']),
        group(['Python', 'Go', 'TypeScript']),
        group(['Rust', 'Go']),
        group(['npm', 'Python'], 'pkg'),
      ].join(''),
    )
    enhanceCodeBlocks(article, { storage })
    const [first, second, third, keyed] = [...article.querySelectorAll('.code-group')]
    if (first === undefined || second === undefined || third === undefined || keyed === undefined) {
      throw new Error('no groups')
    }

    tabsOf(first)[1]?.click()
    expect([selected(first), selected(second), selected(third), selected(keyed)]).toEqual([
      'Python',
      'Python',
      'Rust',
      'npm',
    ])
    expect(storage.saved()).toEqual({ '': 'Python' })

    tabsOf(keyed)[1]?.click()
    expect(selected(first)).toBe('Python')
    expect(storage.saved()).toEqual({ '': 'Python', pkg: 'Python' })

    // The next page opens on the reader's choice.
    const next = page(group(['TypeScript', 'Python']))
    enhanceCodeBlocks(next, { storage })
    expect(selected(next)).toBe('Python')
  })

  it('keeps the group being used still on screen while the page around it changes', () => {
    const article = page(group(['TypeScript', 'Python']) + group(['TypeScript', 'Python']))
    enhanceCodeBlocks(article, { storage: memory() })
    const strip = article.querySelectorAll('[role="tablist"]')[1]
    if (strip === undefined) throw new Error('no strip')
    let top = 400
    vi.spyOn(strip, 'getBoundingClientRect').mockImplementation(() => {
      const box = new DOMRect(0, top, 100, 40)
      top = 460
      return box
    })
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    tabsOf(article)[3]?.click()
    expect(scrollBy).toHaveBeenCalledWith(0, 60)
    scrollBy.mockRestore()
  })

  it('survives a store it may not read or write, or one holding nonsense', () => {
    const broken: ChoiceStorage = {
      getItem: () => {
        throw new DOMException('Denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('Full', 'QuotaExceededError')
      },
    }
    const article = page(group(['TypeScript', 'Python']))
    enhanceCodeBlocks(article, { storage: broken })
    tabsOf(article)[1]?.click()
    expect(selected(article)).toBe('Python')

    for (const value of ['[1]', '"x"', '{"": 3}']) {
      const other = page(group(['TypeScript', 'Python']))
      enhanceCodeBlocks(other, { storage: memory({ [CHOICES_KEY]: value }) })
      expect(selected(other)).toBe('TypeScript')
    }
  })

  it('uses the page’s own store by default, or none where it is refused', () => {
    const article = page(group(['TypeScript', 'Python']))
    enhanceCodeBlocks(article)
    tabsOf(article)[1]?.click()
    expect(localStorage.getItem(CHOICES_KEY)).toBe('{"":"Python"}')
    localStorage.clear()

    const refused = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError')
    })
    const other = page(group(['TypeScript', 'Python']))
    enhanceCodeBlocks(document)
    tabsOf(other)[1]?.click()
    expect(selected(other)).toBe('Python')
    refused.mockRestore()
  })

  it('names a tab with no caption by its place, and leaves an empty group alone', () => {
    const article = page(
      '<div class="code-group"><figure class="code-block"><pre><code>a</code></pre></figure></div><div class="code-group"></div>',
    )
    enhanceCodeBlocks(article, { storage: null })
    expect(tabsOf(article).map((tab) => tab.textContent)).toEqual(['Code 1'])
    expect(article.querySelectorAll('[role="tablist"]')).toHaveLength(1)
  })

  it('offers a selection in the panel on show from the group’s one button', async () => {
    const article = page(group(['TypeScript', 'Python']))
    enhanceCodeBlocks(article, { storage: null })
    const text = article.querySelector('code')?.firstChild
    if (text === null || text === undefined) throw new Error('no text')
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 4)
    document.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await vi.waitFor(() => {
      expect(article.querySelector('.code-copy')?.getAttribute('aria-label')).toBe('Copy selection')
    })
  })

  it('takes everything away again', () => {
    const article = page(group(['TypeScript', 'Python']))
    const before = article.innerHTML
    const dispose = enhanceCodeBlocks(article, { storage: null })
    dispose()
    expect(article.innerHTML.replaceAll(/ hidden=""/gu, '')).toBe(before)
  })
})

describe('the edges of a page', () => {
  it('scrolls a strip of many tabs to the one chosen, either way, and no further', () => {
    const article = page(group(['One', 'Two', 'Three']))
    enhanceCodeBlocks(article, { storage: null })
    const strip = article.querySelector<HTMLElement>('[role="tablist"]')
    if (strip === null) throw new Error('no strip')
    sizes(strip, 0, 200)
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 200 })
    const [one, two, three] = tabsOf(article)
    if (one === undefined || two === undefined || three === undefined) throw new Error('no tabs')
    sizes(one, 0, 100)
    sizes(two, 100, 100)
    sizes(three, 200, 100)

    // The chosen tab is kept clear of the fade at either end.
    three.click()
    expect(strip.scrollLeft).toBe(140)
    two.click()
    expect(strip.scrollLeft).toBe(60)
    two.click()
    expect(strip.scrollLeft).toBe(60)
    one.click()
    expect(strip.scrollLeft).toBe(0)
  })

  it('copies what a panel has: its unwrapped pre, or nothing to copy at all', async () => {
    const article = page(
      '<div class="code-group"><figure class="code-block"><pre>raw</pre></figure><figure class="code-block"><figcaption class="code-caption"><span class="code-label">Empty</span></figcaption></figure></div>',
    )
    const written: string[] = []
    const dispose = enhanceCodeBlocks(article, {
      storage: null,
      clipboard: {
        writeText: async (text) => {
          written.push(text)
        },
      },
    })
    const copy = article.querySelector<HTMLButtonElement>('.code-copy')
    copy?.click()
    await vi.waitFor(() => {
      expect(written).toEqual(['raw'])
    })
    tabsOf(article)[1]?.click()
    copy?.click()
    await vi.waitFor(() => {
      expect(written).toEqual(['raw', 'Empty'])
    })
    dispose()
    expect(article.querySelector('[role="tablist"]')).toBeNull()
  })

  it('gives up offering a selection when it collapses to a caret', async () => {
    const article = page('<div class="code-block"><pre><code>one two</code></pre></div>')
    enhanceCodeBlocks(article, { storage: null })
    const button = article.querySelector('.code-copy')
    const text = article.querySelector('code')?.firstChild
    if (text === null || text === undefined) throw new Error('no text')
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 3)
    document.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await vi.waitFor(() => {
      expect(button?.getAttribute('aria-label')).toBe('Copy selection')
    })
    document.getSelection()?.collapseToStart()
    document.dispatchEvent(new Event('selectionchange'))
    await vi.waitFor(() => {
      expect(button?.getAttribute('aria-label')).toBe('Copy code')
    })
  })

  it('works in a document with no window, which has no store and no frames', () => {
    const detached = document.implementation.createHTMLDocument('')
    detached.body.innerHTML = group(['TypeScript', 'Python'])
    const dispose = enhanceCodeBlocks(detached)
    detached.dispatchEvent(new Event('selectionchange'))
    const [, python] = tabsOf(detached.body)
    python?.click()
    expect(selected(detached.body)).toBe('Python')
    dispose()
  })
})

describe('a strip of many tabs', () => {
  const EIGHT = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C#', 'curl']

  it('says which ends have tabs out of sight, as it scrolls', () => {
    const article = page(group(EIGHT))
    enhanceCodeBlocks(article, { storage: null })
    const strip = article.querySelector<HTMLElement>('[role="tablist"]')
    if (strip === null) throw new Error('no strip')
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 600 })
    Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 300 })

    strip.scrollLeft = 0
    strip.dispatchEvent(new Event('scroll'))
    expect(strip.dataset['overflow']).toBe('end')
    strip.scrollLeft = 150
    strip.dispatchEvent(new Event('scroll'))
    expect(strip.dataset['overflow']).toBe('start end')
    strip.scrollLeft = 300
    strip.dispatchEvent(new Event('scroll'))
    expect(strip.dataset['overflow']).toBe('start')
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 300 })
    strip.scrollLeft = 0
    strip.dispatchEvent(new Event('scroll'))
    expect(strip.dataset['overflow']).toBeUndefined()
    expect(tabsOf(article)).toHaveLength(8)
  })

  it('looks again when the strip changes size, and stops looking when taken away', () => {
    const observed: Element[] = []
    let disconnected = 0
    class FakeObserver {
      callback: () => void
      constructor(callback: () => void) {
        this.callback = callback
      }
      observe(target: Element): void {
        observed.push(target)
      }
      disconnect(): void {
        disconnected += 1
      }
    }
    vi.stubGlobal('ResizeObserver', FakeObserver)
    const article = page(group(EIGHT))
    const dispose = enhanceCodeBlocks(article, { storage: null })
    // The strip, then every block, whose overflow decides whether it is a tab stop.
    expect(observed).toEqual([
      article.querySelector('[role="tablist"]'),
      ...article.querySelectorAll('pre'),
    ])
    dispose()
    expect(disconnected).toBe(2)
    vi.unstubAllGlobals()
  })

  it('makes a block that scrolls sideways a tab stop named by its language', () => {
    const article = page('<div class="code-block"><pre><code data-lang="ts">x</code></pre></div>')
    const pre = article.querySelector('pre')
    if (pre === null) throw new Error('expected a pre')
    Object.defineProperty(pre, 'scrollWidth', { configurable: true, value: 900 })

    const dispose = enhanceCodeBlocks(article, { storage: null, languageLabel })

    expect(pre.tabIndex).toBe(0)
    expect(pre.getAttribute('aria-label')).toBe('TypeScript code, scrolls sideways')
    dispose()
    expect(pre.hasAttribute('tabindex')).toBe(false)
  })
})
