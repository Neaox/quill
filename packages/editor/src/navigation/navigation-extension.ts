import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

import { navigationBlockOf } from './navigation-commands.ts'
import { NavigationOutline } from './navigation-outline.ts'

/**
 * The navigation blocks' place in the editor (ADR-058): the outline a table
 * of contents is drawn from, and a guard that keeps the caret out of a block
 * whose words are written from its settings. Their node views are drawn with
 * every other leaf directive's (`blocks/leaf-directive-views.ts`).
 */

const guardKey = new PluginKey('navigationSelection')

/**
 * A caret that arrives inside a navigation block — by the arrow keys, or by
 * a click ProseMirror resolves into it — selects the block instead: its words
 * are its title, which is written from its settings, never typed blind.
 */
const selectionGuard = new Plugin({
  key: guardKey,
  appendTransaction: (_transactions, _old, state) => {
    const { selection } = state
    if (!(selection instanceof TextSelection)) return null
    const { $from } = selection
    if ($from.depth === 0 || navigationBlockOf($from.parent) === undefined) return null
    return state.tr.setSelection(NodeSelection.create(state.doc, $from.before()))
  },
})

export const NavigationBlocks = Extension.create({
  name: 'navigationBlocks',
  addExtensions() {
    return [NavigationOutline]
  },
  addProseMirrorPlugins() {
    return [selectionGuard]
  },
})
