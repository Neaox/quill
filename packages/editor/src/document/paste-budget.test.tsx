import { parseDocument } from '@quill/markdown'
import * as markdown from '@quill/markdown'
import { act, render } from '@testing-library/react'
import { Node as PMNode } from '@tiptap/pm/model'
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
import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'
import { createIdleQueue } from './idle-queue.ts'
import type { IdleDeadlineLike } from './idle-queue.ts'
import * as parser from './markdown-parser.ts'

/**
 * The paste budget on a long document (quill-plan.md section 31).
 *
 * The report's 4,100-line runbook pasted into an empty document, with the
 * editor wired as the editing route wires it. As with the keystroke budget,
 * counting is the guard that does not flake: one conversion from mdast, a
 * linear amount of decoration work, no CodeMirror for a block that is not
 * near the screen, and no conversion back until the save. Time is then
 * checked step by step after the paste, each step as the median of several
 * runs: the next keystroke against the keystroke budget, and each piece of
 * deferred work — opening a code block, the save's one conversion — against
 * the 50 ms a task may take.
 *
 * Parsing happens in a worker in a browser and is not the page's to time;
 * here it is done up front, so what is timed is the page's own share.
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
/** An idle period no opening can outlast, for a test that counts rather than times. */
const IDLE_FOR_ALL_MS = 60_000
const CODE_BLOCKS = 240

const clock = createFakeClock()
const saves: DocumentAst[] = []
/** How long each conversion the save asked for took, which is the save's own share of the work. */
const conversions: number[] = []
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
        autosave.change(() => {
          const started = performance.now()
          const tree = handle.toMdast()
          conversions.push(performance.now() - started)
          return tree
        })
      }}
    />
  )
}

let source: string
let parsed: DocumentAst
beforeAll(() => {
  source = longDocumentMarkdown()
  parsed = parseDocument(source).ast
  // The worker's answer, already to hand.
  vi.mocked(parser.pageMarkdownParser).mockReturnValue(async () => parsed)
})

afterEach(() => {
  vi.mocked(markdown.mdastToProseMirror).mockClear()
  vi.mocked(markdown.proseMirrorToMdast).mockClear()
  vi.restoreAllMocks()
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
    /** The first `count` blocks come into view. */
    scrollTo(count: number) {
      const entries = watched.slice(0, count).map((target) => ({ target, isIntersecting: true }))
      report?.(entries as unknown as IntersectionObserverEntry[], {} as IntersectionObserver)
    },
    /** One idle period of `ms`, timing each task in it. */
    idle(ms = 50) {
      const callback = idle
      idle = undefined
      const end = performance.now() + ms
      callback?.({ timeRemaining: () => end - performance.now(), didTimeout: false })
    },
  }
}

function clipboard(text: string): ClipboardEvent {
  const clipboardData = new DataTransfer()
  clipboardData.setData('text/plain', text)
  return new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
}

/** Opens an empty session, pastes the runbook, and waits for it to land. */
async function pasted(): Promise<{ editor: Editor; applied: number }> {
  const ref = createRef<DocumentEditorHandle>()
  render(<EditingSession ref={ref} />)
  const editor = ref.current?.editor
  if (editor == null) throw new Error('The editor did not mount.')
  const started = performance.now()
  editor.view.dom.dispatchEvent(clipboard(source))
  await vi.waitFor(() => {
    expect(editor.state.doc.childCount).toBeGreaterThan(1_000)
  })
  return { editor, applied: performance.now() - started }
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

describe('a paste of a 4,100-line document', () => {
  it('converts the pasted tree to editor nodes once, and back again only when the save goes', async () => {
    const page = lazyPage()
    const { editor } = await pasted()
    // The empty document the session opens with is converted too; what is counted is the paste.
    const converted = vi
      .mocked(markdown.mdastToProseMirror)
      .mock.calls.filter(([tree]) => tree.children.length > 0)
    expect(converted).toHaveLength(1)
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

  it('draws its decorations in a linear pass over what was pasted, not a pass per block', async () => {
    const page = lazyPage()
    const walked = countWalkedPositions()
    const { editor } = await pasted()
    // Each derived view — labels, emoji, required sections — reads the
    // pasted range once. A re-scan per changed block would be hundreds.
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
    page.idle(IDLE_FOR_ALL_MS)
    expect(dom.querySelectorAll('.cm-editor')).toHaveLength(3)
    expect(dom.querySelectorAll('pre[data-code-static]')).toHaveLength(CODE_BLOCKS - 3)
    page.restore()
  })

  it(`answers the next keystroke within ${String(KEYSTROKE_BUDGET_MS)} ms and defers nothing longer than ${String(TASK_BUDGET_MS)} ms`, async () => {
    const keystrokes: number[] = []
    const openings: number[] = []
    const saving: number[] = []
    for (let run = 0; run < RUNS; run += 1) {
      const page = lazyPage()
      const { editor } = await pasted()

      const typed = performance.now()
      editor.view.dispatch(editor.state.tr.insertText('x', 1))
      keystrokes.push(performance.now() - typed)

      page.scrollTo(1)
      const opened = performance.now()
      page.idle()
      openings.push(performance.now() - opened)

      conversions.length = 0
      await act(async () => {
        clock.advance(1_000)
        await Promise.resolve()
      })
      // The save's one conversion, not the page redrawing around it, which jsdom draws far
      // more slowly than a browser.
      saving.push(conversions.reduce((total, took) => total + took, 0))
      page.restore()
    }
    expect(median(keystrokes)).toBeLessThan(KEYSTROKE_BUDGET_MS)
    expect(median(openings)).toBeLessThan(TASK_BUDGET_MS)
    expect(median(saving)).toBeLessThan(TASK_BUDGET_MS * 4)
  })
})
