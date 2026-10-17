import { Extension } from '@tiptap/core'
import type { Extensions, NodeConfig } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { NodeView } from '@tiptap/pm/view'

import { navigationBlockOf } from './navigation-commands.ts'
import { NavigationOutline } from './navigation-outline.ts'
import { NavigationBlockView } from './navigation-view.ts'
import type { NavigationViewOptions } from './navigation-view.ts'

/**
 * The navigation blocks' place in the editor (ADR-056): their node views,
 * the outline a table of contents is drawn from, and a guard that keeps the
 * caret out of a block whose words are written from its settings.
 */

/** Any other leaf directive, drawn exactly as the schema draws it. */
function plainView(node: PMNode): NodeView {
  const toDOM = node.type.spec.toDOM
  /* v8 ignore next -- the editor's schema gives every node a DOM (`schema/dom.ts`). */
  if (toDOM === undefined) throw new Error('A leaf directive has no DOM.')
  return DOMSerializer.renderSpec(document, toDOM(node))
}

function withView(options: NavigationViewOptions): Partial<NodeConfig> {
  return {
    addNodeView:
      () =>
      ({ node, editor, getPos, decorations }) => {
        const name = navigationBlockOf(node)
        return name === undefined
          ? plainView(node)
          : new NavigationBlockView(node, name, editor.view, getPos, decorations, options)
      },
  }
}

/** Gives `::toc` and `::children` their preview and settings. */
export function withNavigationViews(
  extensions: Extensions,
  options: NavigationViewOptions = {},
): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'leafDirective'
      ? extension.extend(withView(options))
      : extension,
  )
}

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
