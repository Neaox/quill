import { parseDocument } from '@quill/markdown'
import * as markdown from '@quill/markdown'
import { act, render } from '@testing-library/react'
import { Node as PMNode } from '@tiptap/pm/model'
import { createRef, useState } from 'react'
import type { Ref } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { DocumentAst } from '../document-ast.ts'
import type { DraftClient } from '../drafts/clients.ts'
import { createFakeClock } from '../drafts/clock.ts'
import { createFakeConnectivity } from '../drafts/connectivity.ts'
import { createMemoryRecoveryStore } from '../drafts/recovery-store.ts'
import { useAutosave } from '../drafts/use-autosave.ts'
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

function open() {
  const editorRef = createRef<DocumentEditorHandle>()
  render(<EditingSession ast={longDocument} ref={editorRef} />)
  const editor = editorRef.current?.editor
  if (editor == null) throw new Error('The editor did not mount.')
  // Inside the paragraph of a section halfway down, where a writer would be.
  let paragraph = -1
  editor.state.doc.forEach((node, offset, index) => {
    if (
      paragraph < 0 &&
      index > editor.state.doc.childCount / 2 &&
      node.type.name === 'paragraph'
    ) {
      paragraph = offset + 1
    }
  })
  const keystroke = () => {
    editor.view.dispatch(editor.state.tr.insertText('x', paragraph))
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

  it('walks the whole document zero times', () => {
    const { keystroke } = open()
    const counts = countWholeDocumentWalks()
    for (let typed = 0; typed < KEYSTROKES; typed += 1) keystroke()
    expect(counts).toEqual({ traversals: 0, serialisations: 0 })
  })

  it(`takes under ${String(KEYSTROKE_BUDGET_MS)} ms, as the median of ${String(KEYSTROKES)}`, () => {
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
  })
})
