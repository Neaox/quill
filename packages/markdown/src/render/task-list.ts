import type { Element } from 'hast'
import type { ListItem, Parents } from 'mdast'
import { toString } from 'mdast-util-to-string'
import { defaultHandlers } from 'remark-rehype'
import { EXIT, visit } from 'unist-util-visit'

import type { State } from './hast-state.ts'

/** What a task with no words of its own is called. */
const UNNAMED_TASK = 'Task'

/**
 * The words a task is called by: its first paragraph, on one line. A nested
 * list or a second paragraph is more of the task, not its name.
 */
function taskName(node: ListItem): string {
  const [first] = node.children
  const words = first?.type === 'paragraph' ? toString(first).replace(/\s+/gu, ' ').trim() : ''
  return words.length > 0 ? words : UNNAMED_TASK
}

/**
 * A list item, rendered as GitHub renders it, with a task's checkbox named by
 * the task (WCAG 4.1.2). The checkbox and its words are siblings, so without a
 * name a screen reader says "checkbox, checked, disabled" and only then reads
 * the words as something separate. `aria-label` rather than a `<label>`
 * because a loose task's words are a paragraph, which a label cannot hold.
 */
export function listItem(state: State, node: ListItem, parent: Parents | undefined): Element {
  const item = defaultHandlers.listItem(state, node, parent)
  if (typeof node.checked !== 'boolean') return item
  const name = taskName(node)
  // The item's own checkbox is the first input in it; a nested task's comes later.
  visit(item, 'element', (element) => {
    if (element.tagName !== 'input') return undefined
    element.properties['aria-label'] = name
    return EXIT
  })
  return item
}
