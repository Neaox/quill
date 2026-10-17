import { Extension } from '@tiptap/core'
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from '@tiptap/pm/inputrules'
import { Fragment } from '@tiptap/pm/model'
import type { Schema } from '@tiptap/pm/model'
import type { Plugin } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'

import { nodeType } from '../schema/node-type.ts'

/**
 * Markdown typed at the start of a line becomes the block it means: `## `
 * a heading, `- ` a list, `> ` a quote, `---` a divider. A writer who knows
 * Markdown never has to reach for a menu, and Backspace straight after turns
 * the block back into what was typed, as in every editor that does this.
 *
 * The hints are what the slash menu shows beside each item, so the menu
 * teaches the shortcut and the two can never disagree.
 */
export const AUTOFORMAT_HINTS = {
  heading: (level: number): string => '#'.repeat(level),
  bulletList: '-',
  orderedList: '1.',
  taskList: '[]',
  quote: '>',
  divider: '---',
  codeBlock: '```',
} as const

/** `---`, `***` or `___` alone on a line: a thematic break, and a fresh line after it. */
function dividerRule(schema: Schema): InputRule {
  return new InputRule(/^(?:---|\*\*\*|___)$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start)
    const line = $start.parent
    if (line.type.name !== 'paragraph' || $start.parentOffset !== 0) return null
    // The whole line is the rule; a line with more on it is prose with dashes in it.
    if (line.content.size !== end - start) return null
    const index = $start.index($start.depth - 1)
    const container = $start.node($start.depth - 1)
    const rule = nodeType(schema, 'horizontalRule').create()
    const fresh = nodeType(schema, 'paragraph').create()
    if (!container.canReplace(index, index + 1, Fragment.from([rule, fresh]))) return null
    const tr = state.tr.replaceWith($start.before(), $start.after(), [rule, fresh])
    return tr.setSelection(TextSelection.create(tr.doc, $start.before() + rule.nodeSize + 1))
  })
}

export function autoformatRules(schema: Schema): Plugin {
  return inputRules({
    rules: [
      textblockTypeInputRule(/^#{1,6}\s$/, nodeType(schema, 'heading'), (match) => ({
        level: match[0].trim().length,
      })),
      wrappingInputRule(/^\s*[-+*]\s$/, nodeType(schema, 'bulletList')),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        nodeType(schema, 'orderedList'),
        (match) => ({ start: Number(match[1]) }),
        (match, node) => node.childCount + Number(node.attrs['start']) === Number(match[1]),
      ),
      wrappingInputRule(/^\[ ?\]\s$/, nodeType(schema, 'taskList')),
      wrappingInputRule(/^>\s$/, nodeType(schema, 'blockquote')),
      textblockTypeInputRule(/^```([\w+#-]*)\s$/, nodeType(schema, 'codeBlock'), (match) => ({
        language: match[1] === '' ? null : match[1],
      })),
      dividerRule(schema),
    ],
  })
}

export const Autoformat = Extension.create({
  name: 'autoformat',
  addProseMirrorPlugins() {
    return [autoformatRules(this.editor.schema)]
  },
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => undoInputRule(editor.state, editor.view.dispatch),
    }
  },
})
