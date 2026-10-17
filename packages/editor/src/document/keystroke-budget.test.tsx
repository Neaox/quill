import { parseDocument } from '@quill/markdown'
import * as markdown from '@quill/markdown'
import { act, render } from '@testing-library/react'
import { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { createRef, useState } from 'react'
import type { Ref } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { DocumentAst } from '../document-ast.ts'
import type { DraftClient } from '../drafts/clients.ts'
import { createFakeClock } from '../drafts/clock.ts'
import { createFakeConnectivity } from '../drafts/connectivity.ts'
import { createMemoryRecoveryStore } from '../drafts/recovery-store.ts'
import { useAutosave } from '../drafts/use-autosave.ts'
import { editFind, openFind } from '../find/find-commands.ts'
import { findStateOf } from '../find/find-plugin.ts'
import { longDocumentMarkdown } from '../testing/long-document.ts'
import { DocumentEditor } from './document-editor.tsx'
import type { DocumentEditorHandle } from './document-editor.tsx'

/**
 * The keystroke budget on a long document (quill-plan.md section 31: under
 * 16 ms; P0-6 in docs/research/2026-10-11-editor-vs-confluence.md).
 *
 * The editor is wired here exactly as the editing route wires it — autosave
 * told about every change, the organisation's labels and emoji drawn — over
 * the report's 4,100-line runbook. Time alone is a noisy guard on a shared
 * runner, so the first two guards count instead: a keystroke converts the
 * document to mdast zero times and walks it whole zero times, which is the
 * property that keeps it cheap however long the document grows. The third
 * times it, as a median, against the budget.
 */

vi.mock('@quill/markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof markdown>()
  return {
    ...actual,
    proseMirrorToMdast: vi.fn<typeof actual.proseMirrorToMdast>(actual.proseMirrorToMdast),
  }
})

/** quill-plan.md section 31. */
const KEYSTROKE_BUDGET_MS = 16
/**
 * Under coverage (`QUILL_COVERAGE`, set by the root Vitest config) the code is
 * instrumented and runs several times slower, so a timing measures the
 * instrumentation: the timed budgets skip themselves there and hold in a plain
 * `pnpm test`. What they count rather than time runs either way.
 */
const UNDER_COVERAGE = process.env['QUILL_COVERAGE'] === '1'
const KEYSTROKES = 41

const clock = createFakeClock()
const saves: DocumentAst[] = []
const client: DraftClient = {
  load: async () => ({ ast: { type: 'root', children: [] }, draftVersion: 1, baseRevision: null }),
  save: async (ast, expectedVersion) => {
    saves.push(ast)
    return { status: 'saved', draftVersion: expectedVersion + 1, updatedAt: clock.now() }
  },
}

/** The editing route's wiring, without the route around it. */
function EditingSession({ ast, ref }: { ast: DocumentAst; ref: Ref<DocumentEditorHandle> }) {
  // Made once per session, as the route's are.
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
      ast={ast}
      ref={ref}
      labels={['status']}
      emoji={{ custom: new Map(), labelEmoji: new Map() }}
      onChange={(handle) => {
        autosave.change(handle.toMdast)
      }}
    />
  )
}

let longDocument: DocumentAst
beforeAll(() => {
  longDocument = parseDocument(longDocumentMarkdown()).ast
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Where a writer would be: a paragraph, or a table's cell, in a section halfway down. */
type Place = 'paragraph' | 'table cell'

function open(place: Place = 'paragraph') {
  const editorRef = createRef<DocumentEditorHandle>()
  render(<EditingSession ast={longDocument} ref={editorRef} />)
  const editor = editorRef.current?.editor
  if (editor == null) throw new Error('The editor did not mount.')
  const wanted = place === 'paragraph' ? 'paragraph' : 'table'
  let block = -1
  editor.state.doc.forEach((node, offset, index) => {
    if (block < 0 && index > editor.state.doc.childCount / 2 && node.type.name === wanted) {
      block = offset
    }
  })
  const node = editor.state.doc.nodeAt(block)
  if (node === null) throw new Error(`No ${wanted} halfway down.`)
  // The paragraph's first word, or the end of the last cell's words.
  const caret = place === 'paragraph' ? block + 1 : block + node.nodeSize - 3
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)),
    )
  })
  const keystroke = () => {
    editor.view.dispatch(editor.state.tr.insertText('x'))
  }
  return { editor, keystroke }
}

const isWholeDocument = (node: PMNode) => node.type.name === 'doc'

/** Counts what walks the whole document: a full traversal, or a conversion's `toJSON`. */
function countWholeDocumentWalks() {
  const counts = { traversals: 0, serialisations: 0 }
  const descendants = PMNode.prototype.descendants
  const nodesBetween = PMNode.prototype.nodesBetween
  const toJSON = PMNode.prototype.toJSON
  vi.spyOn(PMNode.prototype, 'descendants').mockImplementation(function (this: PMNode, visit) {
    if (isWholeDocument(this)) counts.traversals += 1
    descendants.call(this, visit)
  })
  vi.spyOn(PMNode.prototype, 'nodesBetween').mockImplementation(
    function (this: PMNode, from, to, visit, start) {
      // A changed block is a few dozen positions of a document of a hundred thousand.
      if (isWholeDocument(this) && to - from > this.content.size / 2) counts.traversals += 1
      nodesBetween.call(this, from, to, visit, start)
    },
  )
  vi.spyOn(PMNode.prototype, 'toJSON').mockImplementation(function (this: PMNode) {
    if (isWholeDocument(this)) counts.serialisations += 1
    return toJSON.call(this)
  })
  return counts
}

/** The next animation frame, where the floating controls measure. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
}

/**
 * Counts what reads the layout: each read after a write makes the browser lay
 * the page out again, which in a long document is the whole keystroke budget.
 */
function countLayoutReads() {
  const counts = { reads: 0 }
  const count = () => {
    counts.reads += 1
  }
  const box = Element.prototype.getBoundingClientRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    count()
    return box.call(this)
  })
  const boxes = Element.prototype.getClientRects
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    count()
    return boxes.call(this)
  })
  for (const getter of ['offsetTop', 'offsetLeft', 'offsetWidth', 'offsetHeight'] as const) {
    vi.spyOn(HTMLElement.prototype, getter, 'get').mockImplementation(() => {
      count()
      return 0
    })
  }
  for (const getter of ['clientWidth', 'clientHeight', 'scrollTop', 'scrollLeft'] as const) {
    vi.spyOn(Element.prototype, getter, 'get').mockImplementation(() => {
      count()
      return 0
    })
  }
  const coordsAtPos = EditorView.prototype.coordsAtPos
  vi.spyOn(EditorView.prototype, 'coordsAtPos').mockImplementation(function (
    this: EditorView,
    ...args: Parameters<EditorView['coordsAtPos']>
  ) {
    count()
    return coordsAtPos.apply(this, args)
  })
  return counts
}

/** A table's handles and toolbar read its cells once a frame: a few dozen reads, never the page's. */
const ONE_TABLE_READS = 40

describe('a keystroke in a 4,100-line document', () => {
  it('is that long a document', () => {
    expect(longDocumentMarkdown().split('\n').length).toBeGreaterThan(4_000)
  })

  it('converts the document to mdast zero times, and once when the save goes', async () => {
    const { keystroke } = open()
    const conversions = vi.mocked(markdown.proseMirrorToMdast)
    conversions.mockClear()
    // In `act`, so the session renders as it would between frames.
    act(() => {
      for (let typed = 0; typed < KEYSTROKES; typed += 1) keystroke()
    })
    expect(conversions).not.toHaveBeenCalled()

    saves.length = 0
    await act(async () => {
      clock.advance(1_000)
      await Promise.resolve()
    })
    expect(conversions).toHaveBeenCalledTimes(1)
    expect(saves).toHaveLength(1)
  })

  it.each<Place>(['paragraph', 'table cell'])(
    'walks the whole document zero times, in a %s',
    (place) => {
      const { keystroke } = open(place)
      const counts = countWholeDocumentWalks()
      for (let typed = 0; typed < KEYSTROKES; typed += 1) keystroke()
      expect(counts).toEqual({ traversals: 0, serialisations: 0 })
    },
  )

  it('walks the whole document zero times with the find bar open and finding', () => {
    const { editor, keystroke } = open()
    act(() => {
      openFind(false)(editor.state, editor.view.dispatch)
      editFind({ query: 'the' })(editor.state, editor.view.dispatch)
    })
    const found = findStateOf(editor.state)?.found.matches.length ?? 0
    // Common enough that every block has some: a search from scratch would be the whole document.
    expect(found).toBeGreaterThan(500)
    const counts = countWholeDocumentWalks()
    act(() => {
      for (let typed = 0; typed < KEYSTROKES; typed += 1) keystroke()
    })
    expect(counts).toEqual({ traversals: 0, serialisations: 0 })
    expect(findStateOf(editor.state)?.found.matches.length).toBe(found)
  })

  it('reads the layout zero times in a paragraph, frames included', async () => {
    const { keystroke } = open()
    await nextFrame()
    const counts = countLayoutReads()
    for (let typed = 0; typed < 5; typed += 1) {
      act(keystroke)
      await nextFrame()
    }
    expect(counts.reads).toBe(0)
  })

  it(`reads the layout of one table, not every table, in a table cell`, async () => {
    const { keystroke } = open('table cell')
    await nextFrame()
    const counts = countLayoutReads()
    for (let typed = 0; typed < 5; typed += 1) {
      act(keystroke)
      await nextFrame()
    }
    // 240 tables placed again would be thousands.
    expect(counts.reads).toBeGreaterThan(0)
    expect(counts.reads / 5).toBeLessThan(ONE_TABLE_READS)
  })

  it.skipIf(UNDER_COVERAGE)(
    `takes under ${String(KEYSTROKE_BUDGET_MS)} ms, as the median of ${String(KEYSTROKES)}`,
    () => {
      const { keystroke } = open()
      // Warm the paths a first keystroke compiles.
      for (let typed = 0; typed < 5; typed += 1) keystroke()
      const times = Array.from({ length: KEYSTROKES }, () => {
        const started = performance.now()
        keystroke()
        return performance.now() - started
      }).toSorted((a, b) => a - b)
      const median = times[Math.floor(times.length / 2)] ?? Number.POSITIVE_INFINITY
      expect(median).toBeLessThan(KEYSTROKE_BUDGET_MS)
    },
  )
})
