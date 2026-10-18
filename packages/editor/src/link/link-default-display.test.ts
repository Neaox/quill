import { NodeSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from '../testing/harness.ts'
import {
  linkDefaultDisplayOf,
  linkDefaultDisplayPlugin,
  withLinkDefaultDisplay,
} from './link-default-display.ts'
import { linkTargetAt } from './link-display.ts'

const harness = createEditorTestHarness()

function selectLeaf(markdown: string): EditorState {
  const opened = harness.state(markdown)
  let found = -1
  opened.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'leafDirective') found = pos
    return found < 0
  })
  const selected = opened.apply(opened.tr.setSelection(NodeSelection.create(opened.doc, found)))
  // The harness builds a bare state; the plugin is what the editor's extension adds.
  return selected.reconfigure({ plugins: [linkDefaultDisplayPlugin()] })
}

const UNCHOSEN = '::link{url="https://blog.example/post"}'
const CHOSEN = '::link{url="https://blog.example/post" display="compact"}'

describe('the display an unchosen link has', () => {
  it('is the product’s default until the application says otherwise', () => {
    const state = selectLeaf(UNCHOSEN)
    expect(linkDefaultDisplayOf(state)).toBe('inline')
    expect(linkTargetAt(state)?.display).toBe('inline')
  })

  it('is the organisation’s default once the application has said what it is', () => {
    const state = selectLeaf(UNCHOSEN)
    const told = state.apply(withLinkDefaultDisplay(state.tr, 'card'))
    expect(linkDefaultDisplayOf(told)).toBe('card')
    expect(linkTargetAt(told)?.display).toBe('card')
  })

  it('can change again, and keeps the selection', () => {
    const state = selectLeaf(UNCHOSEN)
    const first = state.apply(withLinkDefaultDisplay(state.tr, 'card'))
    const second = first.apply(withLinkDefaultDisplay(first.tr, 'compact'))
    expect(linkTargetAt(second)?.display).toBe('compact')
    expect(second.selection.eq(state.selection)).toBe(true)
  })

  it('never overrides what the author chose', () => {
    const state = selectLeaf(CHOSEN)
    const told = state.apply(withLinkDefaultDisplay(state.tr, 'card'))
    expect(linkTargetAt(told)?.display).toBe('compact')
  })

  it('is not part of the document and not an edit to undo', () => {
    const state = selectLeaf(UNCHOSEN)
    const tr = withLinkDefaultDisplay(state.tr, 'card')
    expect(tr.docChanged).toBe(false)
    expect(tr.getMeta('addToHistory')).toBe(false)
  })
})
