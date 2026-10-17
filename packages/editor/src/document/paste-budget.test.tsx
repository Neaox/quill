import { parseDocument } from '@quill/markdown'
import * as markdown from '@quill/markdown'
import { act, render } from '@testing-library/react'
import { Editor as CoreEditor } from '@tiptap/core'
import { undo } from '@tiptap/pm/history'
import { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import { createRef, useState } from 'react'
import type { Ref } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { setCodeMirrorMounting, viewportMounting } from '../code-block/lazy-code-mirror.ts'
import type { DocumentAst } from '../document-ast.ts'
import type { DraftClient } from '../drafts/clients.ts'
import { createFakeClock } from '../drafts/clock.ts'
import { createFakeConnectivity } from '../drafts/connectivity.ts'
import { createMemoryRecoveryStore } from '../drafts/recovery-store.ts'
import { useAutosave } from '../drafts/use-autosave.ts'
import { longDocumentMarkdown } from '../testing/long-document.ts'
import {
  RICH_PASTE_SECTIONS,
  googleDocsHtml,
  plainText,
  wordHtml,
} from '../testing/paste-fixtures.ts'
import { documentFromMdast } from './ast.ts'
import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'
import { buildExtensions } from './extensions.ts'
import { createIdleQueue } from './idle-queue.ts'
import type { IdleDeadlineLike } from './idle-queue.ts'
import * as parser from './markdown-parser.ts'
import type { ParseMarkdown, PasteBatch } from './markdown-parser.ts'
import { isPasteLanding, MarkdownPaste, pasteKey } from './paste.ts'
import { SLICE_BUDGET_MS } from './time-slice.ts'

/**
 * The paste budget on a long document (quill-plan.md section 31).
 *
 * The report's 4,100-line runbook pasted into an empty document, with the
 * editor wired as the editing route wires it. As with the keystroke budget,
 * counting is the guard that does not flake: the page builds the pasted
 * blocks from the worker's JSON and never converts mdast itself, a linear
 * amount of decoration work however many batches it lands in, no CodeMirror
 * for a block that is not near the screen, one undo step, one change heard by
 * autosave, and no conversion back until the save. Time is then checked step
 * by step: the slices the page lands the paste in against half a frame on a
 * fake clock, the next keystroke against the keystroke budget, and each piece
 * of deferred work — opening a code block, the save's one conversion —
 * against the 50 ms a task may take.
 *
 * Parsing happens in workers in a browser and is not the page's to time;
 * here it is done up front, in the pieces the workers would hand over, so
 * what is timed is the page's own share.
 */

vi.mock('@quill/markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof markdown>()
  return {
    ...actual,
    mdastToProseMirror: vi.fn<typeof actual.mdastToProseMirror>(actual.mdastToProseMirror),
    proseMirrorToMdast: vi.fn<typeof actual.proseMirrorToMdast>(actual.proseMirrorToMdast),
  }
})

vi.mock('./markdown-parser.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof parser>()
  return { ...actual, pageMarkdownParser: vi.fn<typeof actual.pageMarkdownParser>() }
})

/** quill-plan.md section 31. */
const KEYSTROKE_BUDGET_MS = 16
const TASK_BUDGET_MS = 50
const RUNS = 5
const CODE_BLOCKS = 240
/** Long enough for jsdom, which draws far slower than a browser, to land the whole paste. */
const LANDING_TIMEOUT = { timeout: 60_000, interval: 20 }

/** What each test here may take: a paste of the whole runbook, drawn by jsdom, under coverage. */
const PASTE_TEST_TIMEOUT = 120_000

const clock = createFakeClock()
const saves: DocumentAst[] = []
const changes = { count: 0 }
const client: DraftClient = {
  load: async () => ({ ast: { type: 'root', children: [] }, draftVersion: 1, baseRevision: null }),
  save: async (ast, expectedVersion) => {
    saves.push(ast)
    return { status: 'saved', draftVersion: expectedVersion + 1, updatedAt: clock.now() }
  },
}

/** The editing route's wiring, without the route around it. */
function EditingSession({ ref }: { ref: Ref<DocumentEditorHandle> }) {
  const [store] = useState(createMemoryRecoveryStore)
  const [connectivity] = useState(createFakeConnectivity)
  const autosave = useAutosave({
    client,
    store,
    documentVersion: 1,
    canSave: true,
    clock,
    connectivity,
  })
  return (
    <DocumentEditor
      ast={{ type: 'root', children: [] }}
      ref={ref}
      labels={['status']}
      emoji={{ custom: new Map(), labelEmoji: new Map() }}
      onChange={(handle) => {
        changes.count += 1
        autosave.change(handle.toMdast)
      }}
    />
  )
}

let source: string
/** Each clipboard's pieces, as the worker pool hands them over. */
const pieces = new Map<string, PasteBatch[]>()

/** The worker pool's answer, already to hand: every piece, in order, a task apart. */
const precomputed: ParseMarkdown = async (text, onBatch, signal) => {
  const batches = pieces.get(text)
  if (batches === undefined) throw new Error('The test did not parse this clipboard.')
  for (const batch of batches) {
    // oxlint-disable-next-line no-await-in-loop -- a piece arrives in a message of its own
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (signal.aborted) return
    onBatch(batch)
  }
}

beforeAll(async () => {
  source = longDocumentMarkdown()
  const stream = parser.streamMarkdown(parser.inPageRunner())
  for (const text of [source, plainText()]) {
    const batches: PasteBatch[] = []
    // oxlint-disable-next-line no-await-in-loop -- two clipboards, parsed once each
    await stream(text, (batch) => batches.push(batch), new AbortController().signal)
    pieces.set(text, batches)
  }
  vi.mocked(parser.pageMarkdownParser).mockReturnValue(precomputed)
})

afterEach(() => {
  vi.mocked(markdown.mdastToProseMirror).mockClear()
  vi.mocked(markdown.proseMirrorToMdast).mockClear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A page whose idle time and viewport the test hands out. */
function lazyPage() {
  let idle: ((deadline: IdleDeadlineLike) => void) | undefined
  const queue = createIdleQueue({
    request: (callback) => {
      idle = callback
      return () => {
        idle = undefined
      }
    },
  })
  const watched: Element[] = []
  let report: IntersectionObserverCallback | undefined
  class Viewport {
    constructor(callback: IntersectionObserverCallback) {
      report = callback
    }
    observe(element: Element) {
      watched.push(element)
    }
    unobserve() {}
  }
  const restore = setCodeMirrorMounting(
    viewportMounting(queue, Viewport as unknown as typeof IntersectionObserver),
  )
  return {
    queue,
    watched,
    restore,
    /** `count` blocks come into view, from the `from`th. */
    scrollTo(count: number, from = 0) {
      const entries = watched
        .slice(from, from + count)
        .map((target) => ({ target, isIntersecting: true }))
      report?.(entries as unknown as IntersectionObserverEntry[], {} as IntersectionObserver)
    },
    /** One idle period of `ms`. */
    idle(ms = 50) {
      const callback = idle
      idle = undefined
      const end = performance.now() + ms
      callback?.({ timeRemaining: () => end - performance.now(), didTimeout: false })
    },
    /** Idle periods until the queue is empty, each task timed on its own. */
    drain() {
      const tasks: number[] = []
      while (idle !== undefined) {
        const callback = idle
        idle = undefined
        let started = performance.now()
        // A period holding one task, so each is measured alone.
        callback({
          timeRemaining: () => {
            const now = performance.now()
            tasks.push(now - started)
            started = now
            return 0
          },
          didTimeout: false,
        })
      }
      return tasks
    },
  }
}

function clipboard(data: Readonly<Record<string, string>>): ClipboardEvent {
  const clipboardData = new DataTransfer()
  for (const [type, value] of Object.entries(data)) clipboardData.setData(type, value)
  return new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
}

/** Opens an empty session and mounts its editor. */
function session(): Editor {
  // jsdom draws nothing, so its frames come at once rather than a sixtieth of
  // a second apart: a paste waiting for one would only wait. How the paste
  // paces itself against drawing is `time-slice.test.ts`'s.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => {
      callback(performance.now())
    }, 0),
  )
  const ref = createRef<DocumentEditorHandle>()
  render(<EditingSession ref={ref} />)
  const editor = ref.current?.editor
  if (editor == null) throw new Error('The editor did not mount.')
  // Opening the empty session converted its one empty paragraph.
  vi.mocked(markdown.mdastToProseMirror).mockClear()
  changes.count = 0
  return editor
}

/** Opens an empty session, pastes `data` (the runbook unless given), and waits for it to land. */
async function pasted(data?: Readonly<Record<string, string>>): Promise<{ editor: Editor }> {
  const editor = session()
  editor.view.dom.dispatchEvent(clipboard(data ?? { 'text/plain': source }))
  await vi.waitFor(() => {
    expect(editor.state.doc.childCount).toBeGreaterThan(100)
    expect(isPasteLanding(editor.state)).toBe(false)
  }, LANDING_TIMEOUT)
  // The change the paste ended with reaches autosave through React.
  await act(async () => {
    await Promise.resolve()
  })
  return { editor }
}

const median = (times: readonly number[]) =>
  times.toSorted((a, b) => a - b)[Math.floor(times.length / 2)] ?? Number.POSITIVE_INFINITY

/** How much of the document every walk over it covered, in positions. */
function countWalkedPositions() {
  const walked = { positions: 0 }
  const nodesBetween = PMNode.prototype.nodesBetween
  const descendants = PMNode.prototype.descendants
  vi.spyOn(PMNode.prototype, 'nodesBetween').mockImplementation(
    function (this: PMNode, from, to, visit, start) {
      if (this.type.name === 'doc') walked.positions += to - from
      nodesBetween.call(this, from, to, visit, start)
    },
  )
  vi.spyOn(PMNode.prototype, 'descendants').mockImplementation(function (this: PMNode, visit) {
    if (this.type.name === 'doc') walked.positions += this.content.size
    descendants.call(this, visit)
  })
  return walked
}

describe('a paste of a 4,100-line document', { timeout: PASTE_TEST_TIMEOUT }, () => {
  it('is acknowledged in the paste’s own task, before anything has been parsed', () => {
    const editor = session()
    editor.view.dom.dispatchEvent(clipboard({ 'text/plain': source }))
    expect(editor.view.dom.querySelector('.paste-status')?.textContent).toContain('Pasting…')
    expect(isPasteLanding(editor.state)).toBe(true)
  })

  it('lands exactly the document a parse of the whole makes, though it came in pieces', async () => {
    const page = lazyPage()
    const { editor } = await pasted()
    expect(pieces.get(source)?.length).toBeGreaterThan(4)
    const whole = documentFromMdast(parseDocument(source).ast, { schema: editor.schema }).doc
    expect(editor.state.doc.toJSON()).toEqual(whole.toJSON())
    page.restore()
  })

  it('builds its blocks from the worker’s JSON, and converts back only when the save goes', async () => {
    const page = lazyPage()
    const { editor } = await pasted()
    // The conversion from mdast happened in the workers, not here.
    expect(markdown.mdastToProseMirror).not.toHaveBeenCalled()
    expect(markdown.proseMirrorToMdast).not.toHaveBeenCalled()

    saves.length = 0
    await act(async () => {
      clock.advance(1_000)
      await Promise.resolve()
    })
    expect(markdown.proseMirrorToMdast).toHaveBeenCalledOnce()
    expect(saves).toHaveLength(1)
    expect(editor.state.doc.childCount).toBeGreaterThan(1_000)
    page.restore()
  })

  it('is heard by autosave once, as the whole paste, however many batches it landed in', async () => {
    const page = lazyPage()
    const { editor } = await pasted()
    expect(changes.count).toBe(1)
    saves.length = 0
    await act(async () => {
      clock.advance(1_000)
      await Promise.resolve()
    })
    expect(saves[0]?.children.length).toBe(editor.state.doc.childCount)
    page.restore()
  })

  it('is taken away whole by one undo', async () => {
    const page = lazyPage()
    const { editor } = await pasted()
    expect(undo(editor.state, editor.view.dispatch)).toBe(true)
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.textContent).toBe('')
    page.restore()
  })

  it('draws its decorations in a linear pass over what was pasted, not a pass per batch', async () => {
    const page = lazyPage()
    const walked = countWalkedPositions()
    const { editor } = await pasted()
    // Each derived view — labels, emoji, required sections — reads each
    // landed range once. A re-scan of the document per batch would be dozens.
    expect(walked.positions).toBeLessThan(8 * editor.state.doc.content.size)
    page.restore()
  })

  it('builds no CodeMirror for a block that is not near the screen', async () => {
    const page = lazyPage()
    const { editor } = await pasted()
    const dom = editor.view.dom
    page.idle()
    expect(dom.querySelectorAll('.cm-editor')).toHaveLength(0)
    expect(dom.querySelectorAll('pre[data-code-static]')).toHaveLength(CODE_BLOCKS)

    // The first screenful comes into view: those, and only those, open. This counts what opens,
    // so the idle period is long enough for all of it; how long one opening takes is timed below.
    page.scrollTo(3)
    page.drain()
    expect(dom.querySelectorAll('.cm-editor')).toHaveLength(3)
    expect(dom.querySelectorAll('pre[data-code-static]')).toHaveLength(CODE_BLOCKS - 3)
    page.restore()
  })

  it(`answers the next keystroke within ${String(KEYSTROKE_BUDGET_MS)} ms and defers nothing longer than ${String(TASK_BUDGET_MS)} ms`, async () => {
    const keystrokes: number[] = []
    const deferred: number[] = []
    const page = lazyPage()
    const { editor } = await pasted()
    for (let run = 0; run < RUNS; run += 1) {
      // Each run types once and opens the next screenful, each timed alone.
      const typed = performance.now()
      editor.view.dispatch(editor.state.tr.insertText('x', 1))
      keystrokes.push(performance.now() - typed)

      // A screenful: each block is coloured, then opened, one idle task at a time.
      page.scrollTo(4, run * 4)
      deferred.push(...page.drain())
    }
    page.restore()
    expect(median(keystrokes)).toBeLessThan(KEYSTROKE_BUDGET_MS)
    expect(median(deferred)).toBeLessThan(TASK_BUDGET_MS)
  })
})

describe('landing a paste in slices', { timeout: PASTE_TEST_TIMEOUT }, () => {
  it(`keeps every slice within ${String(SLICE_BUDGET_MS)} ms on a clock that charges for what is drawn`, async () => {
    // Each landed transaction costs the page in proportion to what it adds,
    // at a rate a throttled phone might draw at; the clock is the page's.
    const RATE_MS = 0.004
    let now = 0
    const slices: { blocks: number; ms: number }[] = []
    const element = document.createElement('div')
    document.body.append(element)
    const editor = new CoreEditor({
      element,
      extensions: buildExtensions().map((extension) =>
        extension.name === MarkdownPaste.name
          ? MarkdownPaste.configure({
              parse: precomputed,
              host: { now: () => now, yield: () => Promise.resolve() },
            })
          : extension,
      ),
    })
    editor.on('transaction', ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta(pasteKey) === undefined || !transaction.docChanged) return
      const ms = (transaction.doc.content.size - transaction.before.content.size) * RATE_MS
      now += ms
      slices.push({ blocks: transaction.doc.childCount - transaction.before.childCount, ms })
    })
    editor.view.dom.dispatchEvent(clipboard({ 'text/plain': source }))
    await vi.waitFor(() => {
      expect(isPasteLanding(editor.state)).toBe(false)
    }, LANDING_TIMEOUT)
    expect(slices.length).toBeGreaterThan(10)
    // Only a slice of a single block, too big for half a frame on its own,
    // may go over; the slicer learns from the first and never repeats it.
    const over = slices.filter((slice) => slice.ms > SLICE_BUDGET_MS + 1e-9)
    expect(over.every((slice) => slice.blocks <= 1)).toBe(true)
    editor.destroy()
  })
})

describe(
  'a paste of a long document from Google Docs, Word, or a log file',
  { timeout: PASTE_TEST_TIMEOUT },
  () => {
    it.each([
      ['Google Docs', { 'text/plain': 'x', 'text/html': googleDocsHtml() }],
      ['Word', { 'text/plain': 'x', 'text/html': wordHtml() }],
    ])('from %s builds no CodeMirror for a block off the screen', async (_from, data) => {
      const page = lazyPage()
      const { editor } = await pasted(data)
      page.drain()
      const dom = editor.view.dom
      expect(dom.querySelectorAll('.cm-editor')).toHaveLength(0)
      expect(dom.querySelectorAll('pre[data-code-static]')).toHaveLength(RICH_PASTE_SECTIONS)
      page.restore()
    })

    it('of ten thousand plain lines lands in pieces, and answers the next keystroke in time', async () => {
      const page = lazyPage()
      const { editor } = await pasted({ 'text/plain': plainText() })
      expect(markdown.mdastToProseMirror).not.toHaveBeenCalled()
      expect(pieces.get(plainText())?.length).toBeGreaterThan(4)
      const typed = performance.now()
      editor.view.dispatch(editor.state.tr.insertText('x', 1))
      expect(performance.now() - typed).toBeLessThan(KEYSTROKE_BUDGET_MS * 4)
      page.restore()
    })
  },
)
