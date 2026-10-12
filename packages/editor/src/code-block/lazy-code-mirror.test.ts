import { EditorView } from '@codemirror/view'
import { tokenize } from '@quill/highlight'
import type { TokenRange } from '@quill/highlight'
import type { HighlightSetLike } from '@quill/highlight/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createIdleQueue } from '../document/idle-queue.ts'
import type { IdleDeadlineLike } from '../document/idle-queue.ts'
import type { CodeMirrorOptions, Painting } from './code-mirror.ts'
import {
  codeMirrorIn,
  createLazyCodeMirror,
  eagerMounting,
  pageMounting,
  setCodeMirrorMounting,
  viewportMounting,
} from './lazy-code-mirror.ts'
import type { CodeMirrorMounting } from './lazy-code-mirror.ts'
import { resolveLanguage } from './languages.ts'
import type { TokenPaintingOptions } from './token-painting.ts'

/**
 * A code block's live editor is built when the block is near the screen or
 * the writer reaches for it (P1-15 in
 * docs/research/2026-10-11-editor-vs-confluence.md). Until then the block is
 * the reader's static `<pre>`, painted with the reader's ranges.
 */

const TYPESCRIPT = resolveLanguage('ts')

/** The CSS Custom Highlight API, as far as painting uses it. */
function highlightApi() {
  const sets = new Map<string, Set<unknown>>()
  class FakeHighlight extends Set<unknown> implements HighlightSetLike {}
  const environment: TokenPaintingOptions['environment'] = {
    CSS: {
      highlights: {
        get: (name) => sets.get(name),
        set: (name, value) => {
          if (value instanceof FakeHighlight) sets.set(name, value)
        },
      },
    },
    Highlight: FakeHighlight,
    createRange: (node, start, end) => ({ node, start, end }),
  }
  const painted = () => [...sets.values()].reduce((count, set) => count + set.size, 0)
  return { environment, painted }
}

function painting(
  environment: TokenPaintingOptions['environment'],
  load: () => Promise<typeof tokenize> = () => Promise.resolve(tokenize),
): Painting & { loaded: () => boolean } {
  let ready: typeof tokenize | undefined
  return {
    tokenizer: {
      current: () => ready,
      load: async () => {
        ready = await load()
        return ready
      },
    },
    environment,
    schedule: (work) => {
      const timer = setTimeout(work, 0)
      return () => {
        clearTimeout(timer)
      }
    },
    loaded: () => ready !== undefined,
  }
}

/** A mounting the test opens by hand, block by block. */
function manualMounting() {
  const watched = new Map<Element, { paint(): void; open(): void }>()
  const mounting: CodeMirrorMounting = {
    watch: (element, block) => {
      watched.set(element, block)
      return () => {
        watched.delete(element)
      }
    },
  }
  return { mounting, watched }
}

function options(overrides: Partial<CodeMirrorOptions> = {}): CodeMirrorOptions {
  const parent = document.createElement('div')
  document.body.append(parent)
  return {
    parent,
    text: 'const a = 1',
    language: TYPESCRIPT,
    editable: true,
    onChange: () => undefined,
    onEscape: () => undefined,
    painting: painting(highlightApi().environment),
    ...overrides,
  }
}

const live = (parent: Element) => parent.querySelector('.cm-editor')
const still = (parent: Element) => parent.querySelector('pre[data-code-static]')

afterEach(() => {
  document.body.replaceChildren()
})

describe('a code block before it is opened', () => {
  it('is the static block, with its text and no editor', () => {
    const { mounting } = manualMounting()
    const given = options()
    const host = createLazyCodeMirror({ ...given, mounting })
    expect(host.mounted).toBe(false)
    expect(live(given.parent)).toBeNull()
    const pre = still(given.parent)
    expect(pre?.textContent).toBe('const a = 1')
    // Inside a contenteditable document, but not itself writable: typing
    // must reach CodeMirror, not the static text.
    expect(pre?.getAttribute('contenteditable')).toBe('false')
  })

  it('takes new text, a language and editability, and opens with them', () => {
    const { mounting, watched } = manualMounting()
    const given = options()
    const host = createLazyCodeMirror({ ...given, mounting })
    host.setText('let b = 2')
    host.setLanguage(resolveLanguage('python'))
    host.setEditable(false)
    expect(still(given.parent)?.textContent).toBe('let b = 2')
    watched.get(still(given.parent) ?? given.parent)?.open()
    expect(host.mounted).toBe(true)
    expect(host.view.state.doc.toString()).toBe('let b = 2')
    expect(host.view.state.facet(EditorView.editable)).toBe(false)
    expect(still(given.parent)).toBeNull()
  })

  it('opens when something asks for its editor', () => {
    const { mounting, watched } = manualMounting()
    const given = options()
    const host = createLazyCodeMirror({ ...given, mounting })
    expect(host.view.state.doc.toString()).toBe('const a = 1')
    expect(live(given.parent)).not.toBeNull()
    // Opened, it is no longer watched.
    expect(watched.size).toBe(0)
  })

  it('forwards to the editor once it is open', () => {
    const { mounting } = manualMounting()
    const given = options()
    const host = createLazyCodeMirror({ ...given, mounting })
    const view = host.view
    host.setText('x')
    host.setEditable(false)
    host.setLanguage(undefined)
    expect(view.state.doc.toString()).toBe('x')
    expect(view.state.facet(EditorView.editable)).toBe(false)
    host.destroy()
    expect(live(given.parent)).toBeNull()
  })

  it('opens and takes the focus when the writer focuses it', () => {
    const { mounting } = manualMounting()
    const given = options()
    const host = createLazyCodeMirror({ ...given, mounting })
    still(given.parent)?.dispatchEvent(new FocusEvent('focus'))
    expect(host.mounted).toBe(true)
    expect(host.view.hasFocus).toBe(true)
  })

  it('opens with the caret where the writer pressed', () => {
    const { mounting } = manualMounting()
    const given = options()
    const host = createLazyCodeMirror({ ...given, mounting })
    const text = still(given.parent)?.querySelector('code')?.firstChild
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: text, offset: 6 }),
    })
    const press = new PointerEvent('pointerdown', { cancelable: true, clientX: 1, clientY: 1 })
    still(given.parent)?.dispatchEvent(press)
    Reflect.deleteProperty(document, 'caretPositionFromPoint')
    expect(press.defaultPrevented).toBe(true)
    expect(host.view.state.selection.main.head).toBe(6)
    expect(host.view.hasFocus).toBe(true)
  })

  it('opens at the start where the browser cannot say where the press was', () => {
    const { mounting } = manualMounting()
    const given = options()
    const host = createLazyCodeMirror({ ...given, mounting })
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: document.body, offset: 3 }),
    })
    still(given.parent)?.dispatchEvent(new PointerEvent('pointerdown', { cancelable: true }))
    Reflect.deleteProperty(document, 'caretPositionFromPoint')
    expect(host.view.state.selection.main.head).toBe(0)
  })

  it('opens at the start in a browser with no caret lookup at all', () => {
    const { mounting } = manualMounting()
    // The page's own painting, which is what a block is given in the app.
    const { painting: _painting, ...given } = options()
    const host = createLazyCodeMirror({ ...given, mounting })
    host.setText('const a = 1')
    still(given.parent)?.dispatchEvent(new PointerEvent('pointerdown', { cancelable: true }))
    expect(host.view.state.selection.main.head).toBe(0)
    host.destroy()
  })

  it('stops being watched when it is destroyed unopened', () => {
    const { mounting, watched } = manualMounting()
    const given = options()
    createLazyCodeMirror({ ...given, mounting }).destroy()
    expect(watched.size).toBe(0)
  })
})

describe("a static block's colours", () => {
  it('are the reader’s ranges, painted once it is near', async () => {
    const { mounting, watched } = manualMounting()
    const api = highlightApi()
    const given = options({ painting: painting(api.environment) })
    const host = createLazyCodeMirror({ ...given, mounting })
    const block = watched.get(still(given.parent) ?? given.parent)
    // The grammars are a chunk of their own: the first paint waits for them.
    block?.paint()
    expect(api.painted()).toBe(0)
    await vi.waitFor(() => {
      expect(api.painted()).toBeGreaterThan(0)
    })
    const ranges: readonly TokenRange[] = tokenize('const a = 1', 'typescript')
    expect(api.painted()).toBe(ranges.length)

    // New text is painted again, not added to what was there.
    host.setText('let b')
    expect(api.painted()).toBe(tokenize('let b', 'typescript').length)
    host.setLanguage(undefined)
    expect(api.painted()).toBe(0)
    host.setLanguage(TYPESCRIPT)
    expect(api.painted()).toBeGreaterThan(0)

    // Opened, CodeMirror paints its own lines and the static ranges go.
    block?.open()
    expect(host.mounted).toBe(true)
    host.destroy()
  })

  it('are not painted for plain text, an empty block, or a browser without the API', async () => {
    const { mounting, watched } = manualMounting()
    const api = highlightApi()
    const plain = options({ language: undefined, painting: painting(api.environment) })
    createLazyCodeMirror({ ...plain, mounting })
    watched.get(still(plain.parent) ?? plain.parent)?.paint()

    const empty = options({ text: '', painting: painting(api.environment) })
    const emptyHost = createLazyCodeMirror({ ...empty, mounting })
    const emptyBlock = watched.get(still(empty.parent) ?? empty.parent)
    emptyBlock?.paint()
    await vi.waitFor(() => {
      expect(emptyHost.mounted).toBe(false)
    })
    emptyBlock?.paint()

    const noApi = options({ painting: painting({ createRange: () => null }) })
    createLazyCodeMirror({ ...noApi, mounting })
    watched.get(still(noApi.parent) ?? noApi.parent)?.paint()
    expect(api.painted()).toBe(0)
  })

  it('are not painted when the block was opened or destroyed while the grammars loaded', async () => {
    const { mounting, watched } = manualMounting()
    const api = highlightApi()
    const slow = painting(api.environment)
    const given = options({ painting: slow })
    const host = createLazyCodeMirror({ ...given, mounting })
    watched.get(still(given.parent) ?? given.parent)?.paint()
    host.destroy()
    await vi.waitFor(() => {
      expect(slow.loaded()).toBe(true)
    })
    expect(api.painted()).toBe(0)
  })
})

describe('mounting near the viewport', () => {
  /** An IntersectionObserver the test reports to. */
  function observerHarness() {
    const observers: { callback: IntersectionObserverCallback; watched: Set<Element> }[] = []
    class FakeObserver {
      readonly watched = new Set<Element>()
      constructor(readonly callback: IntersectionObserverCallback) {
        observers.push(this)
      }
      observe(element: Element) {
        this.watched.add(element)
      }
      unobserve(element: Element) {
        this.watched.delete(element)
      }
    }
    const report = (element: Element, isIntersecting: boolean) => {
      for (const observer of observers) {
        const entry = { target: element, isIntersecting }
        observer.callback(
          [entry as unknown as IntersectionObserverEntry],
          observer as unknown as IntersectionObserver,
        )
      }
    }
    return { FakeObserver, report, observers }
  }

  function idle() {
    let pending: ((deadline: IdleDeadlineLike) => void) | undefined
    const queue = createIdleQueue({
      request: (callback) => {
        pending = callback
        return () => {
          pending = undefined
        }
      },
    })
    return {
      queue,
      run: () => {
        pending?.({ timeRemaining: () => 50, didTimeout: false })
      },
    }
  }

  it('opens a block once it comes near, in idle time, and never one that stays away', () => {
    const { FakeObserver, report } = observerHarness()
    const { queue, run } = idle()
    const mounting = viewportMounting(queue, FakeObserver as unknown as typeof IntersectionObserver)
    const near = options()
    const far = options()
    const nearHost = createLazyCodeMirror({ ...near, mounting })
    const farHost = createLazyCodeMirror({ ...far, mounting })

    report(still(far.parent) ?? far.parent, false)
    report(still(near.parent) ?? near.parent, true)
    expect(nearHost.mounted).toBe(false)
    run()
    expect(nearHost.mounted).toBe(true)
    expect(farHost.mounted).toBe(false)
    expect(queue.size).toBe(0)
  })

  it('stops watching a block destroyed before it came near', () => {
    const { FakeObserver, observers } = observerHarness()
    const { queue } = idle()
    const mounting = viewportMounting(queue, FakeObserver as unknown as typeof IntersectionObserver)
    createLazyCodeMirror({ ...options(), mounting }).destroy()
    expect(observers[0]?.watched.size).toBe(0)
  })

  it('forgets a block destroyed before its turn', () => {
    const { FakeObserver, report, observers } = observerHarness()
    const { queue, run } = idle()
    const mounting = viewportMounting(queue, FakeObserver as unknown as typeof IntersectionObserver)
    const given = options()
    const host = createLazyCodeMirror({ ...given, mounting })
    const pre = still(given.parent) ?? given.parent
    report(pre, true)
    host.destroy()
    expect(queue.size).toBe(0)
    run()
    expect(live(given.parent)).toBeNull()
    expect(observers[0]?.watched.size).toBe(0)
    // A report for something no longer watched changes nothing.
    report(pre, true)
    expect(queue.size).toBe(0)
  })
})

describe("the page's mounting", () => {
  it('opens every block at once where the browser cannot say what is near', () => {
    const restore = setCodeMirrorMounting(eagerMounting)
    const given = options()
    const host = createLazyCodeMirror(given)
    expect(host.mounted).toBe(true)
    host.destroy()
    restore()
  })

  it('watches the viewport where it can, and is made once', () => {
    const restore = setCodeMirrorMounting(undefined)
    const first = pageMounting()
    expect(first).toBe(pageMounting())
    expect(first).not.toBe(eagerMounting)
    restore()

    const missing = setCodeMirrorMounting(undefined)
    const observer = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver')
    Reflect.deleteProperty(globalThis, 'IntersectionObserver')
    expect(pageMounting()).toBe(eagerMounting)
    if (observer !== undefined) Object.defineProperty(globalThis, 'IntersectionObserver', observer)
    missing()
  })
})

describe('finding the editor of a block', () => {
  it('opens a static block, finds an open one, and finds nothing where there is none', () => {
    const { mounting } = manualMounting()
    const given = options()
    const host = createLazyCodeMirror({ ...given, mounting })
    expect(codeMirrorIn(given.parent)).toBe(host.view)
    expect(codeMirrorIn(given.parent)).toBe(host.view)
    expect(codeMirrorIn(undefined)).toBeNull()
    expect(codeMirrorIn(document.createElement('div'))).toBeNull()
  })
})
