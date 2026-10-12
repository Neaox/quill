import { Extension } from '@tiptap/core'
import type { Extensions, NodeConfig } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Command } from '@tiptap/pm/state'
import type { EditorView, NodeView } from '@tiptap/pm/view'

/**
 * A task as the writer meets it: a real checkbox beside its words (WCAG
 * 1.3.1, 4.1.2), as a reader sees one, where before the editor drew a plain
 * bullet and the item's state was nowhere to be seen or heard.
 *
 * The checkbox is a native `<input>`, so a click and Space toggle it as any
 * checkbox does, and it is named by the task's first line. Toggling sets the
 * item's `checked`, one undoable step, which the serialiser writes as `[x]`
 * or `[ ]`; however the list was written (`*`, `1.`, `[X]`), the converter
 * keeps it. From the keyboard inside the task's words, Mod-Enter toggles it
 * too, without leaving the text.
 *
 * The item keeps the class and `data-checked` its `toDOM` gives it
 * (`schema/dom.ts`), and the reading surface's task-list classes, so the box
 * is drawn by `prose.css` exactly as the published one is.
 */

/** What a task with no words is called, as the renderer calls it (`@quill/markdown`). */
const UNNAMED_TASK = 'Task'

function taskName(node: PMNode): string {
  // The schema gives every task a first paragraph (`paragraph block*`).
  const words = node.child(0).textContent.replace(/\s+/gu, ' ').trim()
  return words.length > 0 ? words : UNNAMED_TASK
}

export class TaskItemNodeView implements NodeView {
  readonly dom: HTMLLIElement
  readonly contentDOM: HTMLElement
  private readonly checkbox: HTMLInputElement
  private node: PMNode

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.dom = document.createElement('li')
    this.dom.className = 'task-item task-list-item'

    this.checkbox = document.createElement('input')
    this.checkbox.type = 'checkbox'
    this.checkbox.contentEditable = 'false'
    this.checkbox.addEventListener('change', () => {
      const pos = getPos()
      if (pos === undefined) return
      view.dispatch(view.state.tr.setNodeAttribute(pos, 'checked', this.checkbox.checked))
    })

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'task-item-content'
    this.dom.append(this.checkbox, this.contentDOM)
    this.render()
  }

  private render(): void {
    const checked = this.node.attrs['checked'] === true
    this.checkbox.checked = checked
    this.checkbox.setAttribute('aria-label', taskName(this.node))
    this.dom.dataset['checked'] = String(checked)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  /** The checkbox is the view's own control: ProseMirror leaves its events to it. */
  stopEvent(event: Event): boolean {
    return event.target === this.checkbox
  }

  /** Only the item's words are the document; the checkbox's state is drawn from it. */
  ignoreMutation(mutation: MutationRecord | { target: Node }): boolean {
    return !this.contentDOM.contains(mutation.target)
  }
}

/** Toggles the task the selection is in, the innermost one; false outside every task. */
export const toggleTask: Command = (state, dispatch) => {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name !== 'taskItem') continue
    dispatch?.(
      state.tr.setNodeAttribute($from.before(depth), 'checked', node.attrs['checked'] !== true),
    )
    return true
  }
  return false
}

export const TaskToggle = Extension.create({
  name: 'taskToggle',
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': ({ editor }) => toggleTask(editor.state, editor.view.dispatch),
    }
  },
})

const withView: Partial<NodeConfig> = {
  addNodeView:
    () =>
    ({ node, editor, getPos }) =>
      new TaskItemNodeView(node, editor.view, getPos),
}

/** Gives task items their checkbox. */
export function withTaskItemView(extensions: Extensions): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'taskItem'
      ? extension.extend(withView)
      : extension,
  )
}
