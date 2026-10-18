import { parseDocument, serializeDocument } from '@quill/markdown'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { DocumentEditor } from '../document/document-editor.tsx'
import type { DocumentEditorHandle } from '../document/document-editor.tsx'
import { createEditorTestHarness } from '../testing/harness.ts'
import {
  applyFrontMatter,
  applyFrontMatterSource,
  FrontMatterNodeView,
  frontMatterPosition,
  frontMatterRecord,
  frontMatterSource,
  redoEdit,
  undoEdit,
} from './front-matter-view.ts'

const SOURCE = [
  '---',
  '# who to ask about this document',
  'title: Reading surface tour',
  'type: design',
  'owners: [platform@example.com]',
  'somethingNobodyKnows: kept',
  '---',
  '',
  '# Reading surface tour',
  '',
  'A tour.',
  '',
].join('\n')

function open(source = SOURCE) {
  const ref = createRef<DocumentEditorHandle>()
  const view = render(<DocumentEditor ast={parseDocument(source).ast} ref={ref} />)
  return { ref, ...view }
}

/** The markdown the document would be saved as, front matter included. */
function markdown(ref: { current: DocumentEditorHandle | null }): string {
  const handle = ref.current
  if (handle === null) throw new Error('The editor did not expose a handle.')
  const tree = handle.toMdast()
  return serializeDocument({ frontMatter: parseDocument(SOURCE).frontMatter, ast: tree })
}

describe('the front matter node view', () => {
  it('owns every event and every mutation inside itself, since nothing in it is drawn', () => {
    const nodeView = new FrontMatterNodeView()
    expect(nodeView.dom).toBeInstanceOf(HTMLElement)
    expect(nodeView.stopEvent()).toBe(true)
    expect(nodeView.ignoreMutation()).toBe(true)
  })
})

describe('front matter in the writing surface', () => {
  it('is not drawn: an author meets the properties strip, never YAML', () => {
    const { container } = open()
    expect(screen.queryByText(/somethingNobodyKnows/)).not.toBeInTheDocument()
    const node = container.querySelector('.front-matter-node')
    expect(node).not.toBeNull()
    expect(node).toHaveAttribute('hidden')
  })

  it('is still in the document, so it is still saved', () => {
    const { ref } = open()
    expect(markdown(ref)).toContain('somethingNobodyKnows: kept')
    expect(markdown(ref)).toContain('# who to ask about this document')
  })
})

describe('reading the front matter block', () => {
  const harness = createEditorTestHarness()

  it('reports no source when the block carries something other than a string', () => {
    const state = harness.state(SOURCE)
    const found = frontMatterPosition(state.doc)
    if (found === undefined) throw new Error('The document has no front matter.')
    const next = state.apply(state.tr.setNodeAttribute(found.pos, 'value', 123))
    expect(frontMatterSource(next.doc)).toBeUndefined()
  })
})

describe('writing a record onto the front matter block', () => {
  const harness = createEditorTestHarness()

  it('changes only the keys that changed, keeping order and comments', () => {
    const state = harness.state(SOURCE)
    const before = frontMatterSource(state.doc)
    if (before === undefined) throw new Error('The document has no front matter.')

    let next = state
    applyFrontMatter({
      title: 'Reading surface tour',
      type: 'runbook',
      owners: ['platform@example.com'],
      somethingNobodyKnows: 'kept',
    })(state, (tr) => {
      next = state.apply(tr)
    })

    const after = frontMatterSource(next.doc)
    expect(after).toContain('# who to ask about this document')
    expect(after).toContain('type: runbook')
    expect(after).toContain('somethingNobodyKnows: kept')
    expect(after?.indexOf('title')).toBeLessThan(after?.indexOf('type') ?? 0)
  })

  it('reports nothing to do when the record still says what the block says', () => {
    const state = harness.state(SOURCE)
    expect(applyFrontMatter(parseDocument(SOURCE).frontMatter)(state, undefined)).toBe(false)
  })

  it('gives a document with no front matter a block, at the top', () => {
    const state = harness.state('# A blank document\n')
    expect(frontMatterPosition(state.doc)).toBeUndefined()

    let next = state
    applyFrontMatter({ type: 'design' })(state, (tr) => {
      next = state.apply(tr)
    })

    expect(frontMatterPosition(next.doc)?.pos).toBe(0)
    expect(frontMatterSource(next.doc)).toBe('type: design')
  })

  it('refuses to add an empty block to a document that has none', () => {
    const state = harness.state('# A blank document\n')
    expect(applyFrontMatter({})(state, undefined)).toBe(false)
  })

  it('never empties a block it cannot rewrite, because metadata is not deleted (rule 7)', () => {
    const state = harness.state(SOURCE)
    expect(applyFrontMatter({})(state, undefined)).toBe(false)
    expect(frontMatterSource(state.doc)).toContain('somethingNobodyKnows: kept')
  })
})

describe('front matter as source', () => {
  const harness = createEditorTestHarness()

  it('puts the YAML on the block exactly as it was written, comments and all', () => {
    const state = harness.state(SOURCE)
    let next = state
    const yaml = '# edited by hand\ntitle: Reading surface tour\ntype: runbook # was design'
    expect(
      applyFrontMatterSource(yaml)(state, (tr) => {
        next = state.apply(tr)
      }),
    ).toBe(true)
    expect(frontMatterSource(next.doc)).toBe(yaml)
  })

  it('reports nothing to do when the source is unchanged, and adds a block where there is none', () => {
    const state = harness.state(SOURCE)
    expect(applyFrontMatterSource(frontMatterSource(state.doc) ?? '')(state, undefined)).toBe(false)

    const blank = harness.state('# A blank document\n')
    let next = blank
    applyFrontMatterSource('type: design')(blank, (tr) => {
      next = blank.apply(tr)
    })
    expect(frontMatterSource(next.doc)).toBe('type: design')
    expect(applyFrontMatterSource('')(blank, undefined)).toBe(false)
  })

  it('reads the block back as a record, or keeps the one it had when there is no block', () => {
    expect(frontMatterRecord(harness.state(SOURCE).doc, {})).toMatchObject({
      type: 'design',
      somethingNobodyKnows: 'kept',
    })
    const fallback = { id: 'doc-1' }
    expect(frontMatterRecord(harness.state('# Blank\n').doc, fallback)).toBe(fallback)
  })
})

describe('a property change in the undo history', () => {
  it('is its own step, undone and redone like any edit', () => {
    const { ref } = open()
    const editor = ref.current?.editor
    if (editor == null) throw new Error('The editor did not mount.')
    const base = frontMatterRecord(editor.state.doc, {})

    applyFrontMatter({ ...base, type: 'runbook' })(editor.state, editor.view.dispatch)
    applyFrontMatter({ ...base, type: 'runbook', status: 'draft' })(
      editor.state,
      editor.view.dispatch,
    )
    expect(frontMatterRecord(editor.state.doc, {})).toMatchObject({
      type: 'runbook',
      status: 'draft',
    })

    expect(undoEdit(editor.state, editor.view.dispatch)).toBe(true)
    expect(frontMatterRecord(editor.state.doc, {})).toMatchObject({ type: 'runbook' })
    expect(frontMatterRecord(editor.state.doc, {})['status']).toBeUndefined()

    expect(redoEdit(editor.state, editor.view.dispatch)).toBe(true)
    expect(frontMatterRecord(editor.state.doc, {})['status']).toBe('draft')
  })
})
