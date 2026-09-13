import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { editorSchema } from '../schema/editor-schema.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { documentToMdast } from './ast.ts'
import {
  insertHardBreak,
  insertImage,
  insertMarkdown,
  insertNode,
  markdownFragment,
  removeLink,
  setLink,
} from './commands.ts'

const harness = createEditorTestHarness()

function caret(markdown: string, at: number): EditorState {
  const state = harness.state(markdown)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)))
}

function selecting(markdown: string, from: number, to: number): EditorState {
  const state = harness.state(markdown)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
}

function apply(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null
  const ran = command(state, (tr) => {
    next = state.apply(tr)
  })
  return ran ? next : null
}

function written(state: EditorState | null): string {
  if (state === null) throw new Error('The command declined to run.')
  return harness.read(documentToMdast(state.doc).tree)
}

describe('the shared editing commands', () => {
  it('inserts a hard break where one is allowed', () => {
    expect(written(apply(caret('One two.\n', 4), insertHardBreak))).toContain('\\\n')
  })

  it('declines a hard break where the content does not allow one', () => {
    expect(apply(caret('```\ncode\n```\n', 2), insertHardBreak)).toBeNull()
  })

  it('links a selection, and unlinks it again', () => {
    const linked = apply(selecting('Read the guide.\n', 10, 15), setLink('/guide', 'The guide'))
    expect(written(linked)).toContain('[guide](/guide "The guide")')
    if (linked === null) throw new Error('Linking declined.')
    const unlinked = apply(selecting('Read [the guide](/guide).\n', 6, 15), removeLink)
    expect(written(unlinked)).not.toContain('](/guide)')
  })

  it('declines to link or unlink nothing', () => {
    expect(apply(caret('Text.\n', 1), setLink('/a'))).toBeNull()
    expect(apply(caret('Text.\n', 1), removeLink)).toBeNull()
  })

  it('inserts an image by address, with and without its description', () => {
    expect(written(apply(caret('\n', 1), insertImage({ src: '/a.png' })))).toContain('![](/a.png)')
    const described = insertImage({ src: '/b.png', alt: 'A chart', title: 'Q3' })
    expect(written(apply(caret('\n', 1), described))).toContain('![A chart](/b.png "Q3")')
  })

  it('inserts a node it is handed', () => {
    const rule = harness.state('\n').schema.nodes['horizontalRule']?.create()
    if (rule === undefined) throw new Error('The schema has no rule node.')
    expect(written(apply(caret('Text.\n', 1), insertNode(rule)))).toContain('---')
  })

  it('reads pasted Markdown as blocks, not as text', () => {
    const pasted = '## A heading\n\n- one\n- two\n'
    expect(written(apply(caret('Text.\n', 6), insertMarkdown(pasted)))).toContain('## A heading')
    expect(markdownFragment(pasted, editorSchema).childCount).toBe(2)
  })

  it('joins a single pasted paragraph to the sentence the caret is in', () => {
    const state = apply(caret('Before after.\n', 8), insertMarkdown('**bold**'))
    expect(written(state)).toBe('Before **bold**after.\n')
  })

  it('drops front matter from pasted Markdown, which only a file may carry', () => {
    const pasted = '---\ntitle: Other\n---\n\nJust the prose.\n'
    expect(written(apply(caret('Text.\n', 6), insertMarkdown(pasted)))).not.toContain('title:')
  })

  it('pastes nothing when there is nothing to paste', () => {
    expect(written(apply(caret('Text.\n', 1), insertMarkdown('')))).toBe('Text.\n')
  })

  it('reports rather than acts when asked without a dispatch', () => {
    expect(insertHardBreak(caret('One.\n', 2))).toBe(true)
    expect(setLink('/a')(selecting('One.\n', 1, 4))).toBe(true)
    expect(removeLink(selecting('One.\n', 1, 4))).toBe(true)
    expect(insertMarkdown('x')(caret('One.\n', 2))).toBe(true)
    expect(insertImage({ src: '/a.png' })(caret('One.\n', 2))).toBe(true)
  })
})
