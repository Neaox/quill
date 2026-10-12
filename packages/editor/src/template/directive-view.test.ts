import { Mark } from '@tiptap/core'
import { EditorView as ProseMirrorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { nodeType } from '../schema/node-type.ts'
import { editorSchema } from '../schema/editor-schema.ts'
import { withDom } from '../schema/dom.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { DirectiveNodeView, isAdded } from './directive-view.ts'

/**
 * A directive can carry anything, including a name the editor has never heard
 * of, an attribute with no value, and no name at all. None of those is an error
 * — the document said it, so the card shows what it can and keeps the rest.
 */

const harness = createEditorTestHarness()

function directive(attributes: Record<string, string | null>, name: string | null): PMNode {
  return nodeType(editorSchema, 'containerDirective').create(
    { name, attributes },
    nodeType(editorSchema, 'paragraph').create(null, editorSchema.text('Body.')),
  )
}

function mount(node: PMNode, pos: () => number | undefined = () => 0) {
  const state = harness.state('Anything.\n')
  const host = document.createElement('div')
  document.body.append(host)
  const view = new ProseMirrorView(host, { state })
  return { view, nodeView: new DirectiveNodeView(node, view, pos, []) }
}

function action(nodeView: DirectiveNodeView): HTMLButtonElement | null {
  return nodeView.dom.querySelector('button')
}

describe('a directive card', () => {
  it('falls back to a plain card for a directive with no name at all', () => {
    const { nodeView, view } = mount(directive({}, null))
    expect(nodeView.dom.tagName).toBe('DIV')
    expect(nodeView.dom).toHaveAttribute('aria-label', 'directive')
    expect(nodeView.dom.className).toContain('directive-unknown')
    expect(nodeView.dom).not.toHaveAttribute('role')
    view.destroy()
  })

  it('offers an untitled optional section under a name of its own', () => {
    const { nodeView, view } = mount(directive({}, 'optional'))
    expect(nodeView.dom).toHaveAttribute('aria-label', 'Optional: Optional section')
    expect(action(nodeView)).toHaveAccessibleName('Add section: Optional section')
    view.destroy()
  })

  it('reads an attribute with no value as an empty one', () => {
    const node = directive({ title: 'Named', added: null }, 'optional')
    const { nodeView, view } = mount(node)
    expect(isAdded(node)).toBe(true)
    expect(action(nodeView)).toBeNull()
    view.destroy()
  })

  it('reads a directive whose attributes are missing as having none', () => {
    const bare = nodeType(editorSchema, 'containerDirective').create(
      { name: 'callout', attributes: null },
      nodeType(editorSchema, 'paragraph').create(),
    )
    const { nodeView, view } = mount(bare)
    expect(nodeView.dom).toHaveAttribute('aria-label', 'Callout: note')
    view.destroy()
  })

  it('shows a callout’s tone in words and in the reader’s colours, and follows a change of tone', () => {
    const { nodeView, view } = mount(directive({ type: 'warning' }, 'callout'))
    const title = nodeView.dom.querySelector(':scope > .callout-label')

    expect(nodeView.dom).toHaveClass('callout', 'callout-warning')
    expect(title).toHaveTextContent('Warning')
    // The group already says it; the title is for the eye.
    expect(title).toHaveAttribute('aria-hidden', 'true')
    expect(title).toHaveAttribute('contenteditable', 'false')

    expect(nodeView.update(directive({ type: 'tip' }, 'callout'), [])).toBe(true)
    expect(nodeView.dom).toHaveClass('callout-tip')
    expect(nodeView.dom).not.toHaveClass('callout-warning')
    expect(nodeView.dom.querySelectorAll('.callout-label')).toHaveLength(1)
    expect(nodeView.dom.querySelector('.callout-label')).toHaveTextContent('Tip')
    expect(nodeView.dom).toHaveAttribute('aria-label', 'Callout: tip')
    view.destroy()
  })

  it('names a callout by its own title, which the page does, and by its tone when it has none', () => {
    const titled = nodeType(editorSchema, 'containerDirective').create(
      { name: 'callout', attributes: { type: 'tip' } },
      [
        nodeType(editorSchema, 'paragraph').create(
          { directiveLabel: true },
          editorSchema.text('Heads up'),
        ),
        nodeType(editorSchema, 'paragraph').create(null, editorSchema.text('Body.')),
      ],
    )
    const { nodeView, view } = mount(titled)

    // The title is the callout's first paragraph, drawn as its heading; the tone's name is not said twice.
    expect(nodeView.dom.querySelector(':scope > .callout-label')).toBeNull()
    expect(nodeView.dom).toHaveClass('callout', 'callout-tip')

    expect(nodeView.update(directive({ type: 'tip' }, 'callout'), [])).toBe(true)
    expect(nodeView.dom.querySelector(':scope > .callout-label')).toHaveTextContent('Tip')

    expect(nodeView.update(titled, [])).toBe(true)
    expect(nodeView.dom.querySelector(':scope > .callout-label')).toBeNull()
    view.destroy()
  })

  it('draws an unknown tone as a note, as the reader does, and other cards without one', () => {
    const unknown = mount(directive({ type: 'shout' }, 'callout'))
    expect(unknown.nodeView.dom).toHaveClass('callout-note')
    expect(unknown.nodeView.dom.querySelector('.callout-label')).toHaveTextContent('Note')
    unknown.view.destroy()

    const guidance = mount(directive({}, 'guidance'))
    expect(guidance.nodeView.dom).not.toHaveClass('callout')
    expect(guidance.nodeView.dom.querySelector('.callout-label')).toBeNull()
    guidance.view.destroy()
  })

  it('does nothing when its block has already left the document', () => {
    const { nodeView, view } = mount(directive({ title: 'Gone' }, 'optional'), () => undefined)
    const before = view.state.doc.toString()
    action(nodeView)?.click()
    expect(view.state.doc.toString()).toBe(before)

    const guidance = mount(directive({}, 'guidance'), () => undefined)
    action(guidance.nodeView)?.click()
    expect(guidance.nodeView.dom).not.toHaveAttribute('data-dismissed')
    guidance.view.destroy()
    view.destroy()
  })

  it('refuses to become a directive of another name', () => {
    const { nodeView, view } = mount(directive({}, 'guidance'))
    expect(nodeView.update(directive({}, 'callout'), [])).toBe(false)
    expect(nodeView.update(directive({}, 'guidance'), [])).toBe(true)
    view.destroy()
  })
})

describe('the DOM given to the schema', () => {
  it('leaves a mark it has no HTML for alone', () => {
    const unknown = Mark.create({ name: 'highlight' })
    expect(withDom([unknown])).toEqual([unknown])
  })
})
