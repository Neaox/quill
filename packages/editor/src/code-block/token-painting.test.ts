import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tokenize, type SupportedLanguage, type TokenRange } from '@quill/highlight'
import { tokenHighlightName, type HighlightSetLike } from '@quill/highlight/client'
import { describe, expect, it, vi } from 'vitest'

import {
  LARGE_BLOCK_CHARS,
  frameSchedule,
  lazyTokenizer,
  paintedRanges,
  tokenPainting,
  type PaintEnvironment,
  type TokenizerSource,
} from './token-painting.ts'

/** A tokenizer that is already loaded: what every block after the first sees. */
const loaded: TokenizerSource = { current: () => tokenize, load: () => Promise.resolve(tokenize) }

/** The fallback: a browser without `CSS.highlights`, which jsdom is. */
const spansOnly: PaintEnvironment = { createRange: () => null }

/** The grammars, arriving when the test says so. */
function deferredTokenizer() {
  const settled = Promise.withResolvers<typeof tokenize>()
  return {
    promise: settled.promise,
    resolve: () => {
      settled.resolve(tokenize)
    },
  }
}

/** Runs scheduled work when the test says so, as a frame would. */
function manualScheduler() {
  const queue: Array<() => void> = []
  return {
    schedule: (run: () => void) => {
      queue.push(run)
      return () => {
        queue.splice(queue.indexOf(run), 1)
      }
    },
    flush: () => {
      for (const run of queue.splice(0)) run()
    },
    get pending() {
      return queue.length
    },
  }
}

function mount(
  text: string,
  language: SupportedLanguage | undefined,
  options: {
    tokenizer?: TokenizerSource
    environment?: PaintEnvironment
    scheduler?: ReturnType<typeof manualScheduler>
  } = {},
) {
  const scheduler = options.scheduler ?? manualScheduler()
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: tokenPainting({
        language,
        tokenizer: options.tokenizer ?? loaded,
        environment: options.environment ?? spansOnly,
        schedule: scheduler.schedule,
      }),
    }),
  })
  return { view, scheduler }
}

const typescript = 'const greeting: string = "hello"\n// done\n'

describe('the editor’s token painting', () => {
  it('paints the reader’s ranges, class for class', () => {
    const { view } = mount(typescript, 'typescript')
    expect(paintedRanges(view.state)).toEqual(tokenize(typescript, 'typescript'))
  })

  it('falls back to spans with the reader’s classes where CSS.highlights is missing', () => {
    const { view } = mount(typescript, 'typescript')
    const keyword = view.contentDOM.querySelector('.tok-keyword')
    expect(keyword?.textContent).toBe('const')
    expect(view.contentDOM.querySelector('.tok-string')?.textContent).toBe('"hello"')
  })

  it('paints nothing for plain text', () => {
    const { view } = mount(typescript, undefined)
    expect(paintedRanges(view.state)).toEqual([])
    expect(view.contentDOM.querySelector('[class*="tok-"]')).toBeNull()
  })

  it('carries the ranges through an edit at once, and re-tokenizes on the next frame', () => {
    const { view, scheduler } = mount('let a = 1', 'javascript')
    view.dispatch({ changes: { from: 0, insert: '  ' } })

    // Moved with the text, not yet re-tokenized.
    expect(paintedRanges(view.state)[0]).toEqual({ start: 2, end: 5, type: 'keyword' })
    expect(scheduler.pending).toBe(1)

    // Several keystrokes in one frame are one tokenize.
    view.dispatch({ changes: { from: view.state.doc.length, insert: '2' } })
    expect(scheduler.pending).toBe(1)

    scheduler.flush()
    expect(paintedRanges(view.state)).toEqual(tokenize('  let a = 12', 'javascript'))
  })

  it('gives a block larger than the reader embeds a longer pause', () => {
    const schedule = vi.fn<(work: () => void, large: boolean) => () => void>(() => () => undefined)
    const parent = document.createElement('div')
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'x'.repeat(LARGE_BLOCK_CHARS),
        extensions: tokenPainting({
          language: 'javascript',
          tokenizer: loaded,
          environment: spansOnly,
          schedule,
        }),
      }),
    })
    view.dispatch({ changes: { from: 0, insert: 'y' } })
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), true)
  })

  it('cancels its pending frame when the block goes away', () => {
    const { view, scheduler } = mount('let a = 1', 'javascript')
    view.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(scheduler.pending).toBe(1)
    view.destroy()
    expect(scheduler.pending).toBe(0)
  })

  it('paints once the grammars arrive when they are not loaded yet', async () => {
    const arriving = deferredTokenizer()
    const tokenizer = lazyTokenizer(() => arriving.promise)
    const { view } = mount('let a = 1', 'javascript', { tokenizer })
    expect(paintedRanges(view.state)).toEqual([])

    arriving.resolve()
    await vi.waitFor(() => {
      expect(paintedRanges(view.state)).toEqual(tokenize('let a = 1', 'javascript'))
    })
    expect(tokenizer.current()).toBe(tokenize)
  })

  it('loads the grammars once, however many blocks ask', async () => {
    const load = vi.fn<() => Promise<typeof tokenize>>(() => Promise.resolve(tokenize))
    const tokenizer = lazyTokenizer(load)
    await Promise.all([tokenizer.load(), tokenizer.load()])
    mount('let a', 'javascript', { tokenizer })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('ignores grammars that arrive after the block is gone', async () => {
    const arriving = deferredTokenizer()
    const tokenizer = lazyTokenizer(() => arriving.promise)
    const { view } = mount('let a', 'javascript', { tokenizer })
    view.destroy()
    arriving.resolve()
    await tokenizer.load()
    expect(view.state.doc.toString()).toBe('let a')
  })
})

describe('the ranges presentation', () => {
  class FakeHighlight implements HighlightSetLike {
    readonly ranges = new Set<unknown>()
    add(range: unknown) {
      this.ranges.add(range)
    }
    delete(range: unknown) {
      this.ranges.delete(range)
    }
  }

  interface Painted {
    readonly node: { readonly data: string }
    readonly start: number
    readonly end: number
  }

  function rangesEnvironment() {
    const highlights = new Map<string, FakeHighlight>()
    const environment: PaintEnvironment = {
      CSS: {
        highlights: {
          get: (name) => highlights.get(name),
          set: (name, value) => {
            if (value instanceof FakeHighlight) highlights.set(name, value)
          },
        },
      },
      Highlight: FakeHighlight,
      createRange: (node, start, end): Painted => ({ node, start, end }),
    }
    const painted = (tokenClass: TokenRange['type']): string[] =>
      [...(highlights.get(tokenHighlightName(tokenClass))?.ranges ?? [])].map((range) => {
        const { node, start, end } = range as Painted
        return node.data.slice(start, end)
      })
    return { environment, painted, highlights }
  }

  it('paints the lines on screen through the page’s Highlights, with no span per token', async () => {
    const { environment, painted } = rangesEnvironment()
    const { view } = mount('const a = "x"\n/* one\ntwo */', 'javascript', { environment })
    await Promise.resolve()

    expect(painted('keyword')).toEqual(['const'])
    expect(painted('string')).toEqual(['"x"'])
    // A comment over two lines is painted in each line's own text node.
    expect(painted('comment')).toEqual(['/* one', 'two */'])
    expect(view.contentDOM.querySelector('[class*="tok-"]')).toBeNull()
  })

  it('repaints after an edit, and removes exactly its own ranges when the block goes away', async () => {
    const { environment, painted } = rangesEnvironment()
    const { view, scheduler } = mount('let a', 'javascript', { environment })
    const other = mount('const b', 'javascript', { environment })
    await Promise.resolve()

    view.dispatch({ changes: { from: 0, to: 3, insert: 'var' } })
    scheduler.flush()
    expect(painted('keyword').toSorted()).toEqual(['const', 'var'])

    view.destroy()
    expect(painted('keyword')).toEqual(['const'])
    other.view.destroy()
    expect(painted('keyword')).toEqual([])
  })
})

describe('frameSchedule', () => {
  it('runs on the next frame, or after a pause for a large block, and can be cancelled', () => {
    vi.useFakeTimers()
    const work = vi.fn<() => void>()
    frameSchedule(work, true)
    frameSchedule(work, false)
    const cancelled = vi.fn<() => void>()
    frameSchedule(cancelled, false)()
    frameSchedule(cancelled, true)()
    vi.advanceTimersByTime(500)
    expect(work).toHaveBeenCalledTimes(2)
    expect(cancelled).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('paintedRanges', () => {
  it('reads nothing from a block that is not painted', () => {
    expect(paintedRanges(EditorState.create({ doc: 'x' }))).toEqual([])
  })
})
