import { Extension } from '@tiptap/core'
import type { Extensions, NodeConfig } from '@tiptap/core'
import { InputRule, inputRules } from '@tiptap/pm/inputrules'
import type { Schema } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Plugin } from '@tiptap/pm/state'

import {
  backspaceInDetails,
  createDetailsNode,
  enterFromSummary,
  exitDetails,
} from './details-commands.ts'
import { detailsFolds } from './details-folds.ts'
import { DetailsNodeView } from './details-view.ts'

/**
 * Everything a details does in the editor beyond its schema (ADR-048): its
 * view, the folds the author makes while writing, its keys, and its Markdown
 * autoformat — `+++` and a space on an empty line, the fence Markdown
 * editors that have a collapsible block (Typora, MarkText) use for it.
 */

/** The autoformat that makes a details, shown beside the slash item as a key. */
export const DETAILS_AUTOFORMAT = '+++'

/** `+++` and a space, alone on a line: a details, with the caret in its summary. */
export function detailsInputRule(schema: Schema): InputRule {
  return new InputRule(/^\+\+\+\s$/u, (state, _match, start, end) => {
    const $start = state.doc.resolve(start)
    const line = $start.parent
    if (line.type.name !== 'paragraph' || line.content.size !== end - start) return null
    const index = $start.index($start.depth - 1)
    const container = $start.node($start.depth - 1)
    const details = createDetailsNode(schema)
    if (!container.canReplaceWith(index, index + 1, details.type)) return null
    const tr = state.tr.replaceWith($start.before(), $start.after(), details)
    return tr.setSelection(TextSelection.create(tr.doc, $start.before() + 2))
  })
}

function detailsInputRules(schema: Schema): Plugin {
  return inputRules({ rules: [detailsInputRule(schema)] })
}

export const DetailsEditing = Extension.create({
  name: 'detailsEditing',
  // Above the general keymap, so Enter in a summary is a details' before it is a
  // paragraph's; below the slash menu, which takes Enter first while it is open.
  priority: 1050,
  addProseMirrorPlugins() {
    return [detailsFolds, detailsInputRules(this.editor.schema)]
  },
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) =>
        enterFromSummary(editor.state, editor.view.dispatch) ||
        exitDetails(editor.state, editor.view.dispatch),
      Backspace: ({ editor }) => backspaceInDetails(editor.state, editor.view.dispatch),
    }
  },
})

const withView: Partial<NodeConfig> = {
  addNodeView:
    () =>
    ({ node, editor, getPos, decorations }) =>
      new DetailsNodeView(node, editor.view, getPos, decorations),
}

/** Gives details their view: an editable summary line, a body, and their two controls. */
export function withDetailsView(extensions: Extensions): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'details'
      ? extension.extend(withView)
      : extension,
  )
}
