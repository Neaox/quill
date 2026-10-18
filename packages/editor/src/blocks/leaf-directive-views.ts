import type { Extensions, NodeConfig } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { navigationBlockOf } from '../navigation/navigation-commands.ts'
import { NavigationBlockView } from '../navigation/navigation-view.ts'
import type { NavigationViewOptions } from '../navigation/navigation-view.ts'
import { directiveName } from '../schema/directive-attributes.ts'
import { LinkCardBlock } from './link-card-view.tsx'

/**
 * How a leaf directive is drawn in the writing surface.
 *
 * The navigation blocks (`::toc`, `::children`, ADR-058) are drawn as they will
 * read, with their settings on the block; a `::link` is the card, compact line
 * or embed it will be (ADR-042). Every other leaf directive stays what the
 * schema draws, a line of editable text, because an unknown directive must
 * survive a round trip untouched (AGENTS.md rule 7).
 */

/** Any other leaf directive, drawn exactly as the schema draws it. */
function plainView(node: PMNode): NodeView {
  const toDOM = node.type.spec.toDOM
  /* v8 ignore next -- the editor's schema gives every node a DOM (`schema/dom.ts`). */
  if (toDOM === undefined) throw new Error('A leaf directive has no DOM.')
  return DOMSerializer.renderSpec(document, toDOM(node))
}

function withView(options: NavigationViewOptions): Partial<NodeConfig> {
  // A React node view, which is how a card reaches the application's previews (`LinkPreviewSource`).
  const linkCard = ReactNodeViewRenderer(LinkCardBlock)
  return {
    addNodeView: () => (props) => {
      const { node, editor, getPos, decorations } = props
      const name = navigationBlockOf(node)
      if (name !== undefined) {
        return new NavigationBlockView(node, name, editor.view, getPos, decorations, options)
      }
      return directiveName(node) === 'link' ? linkCard(props) : plainView(node)
    },
  }
}

/** Gives `::toc` and `::children` their preview and settings, and a `::link` its card. */
export function withLeafDirectiveViews(
  extensions: Extensions,
  options: NavigationViewOptions = {},
): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'leafDirective'
      ? extension.extend(withView(options))
      : extension,
  )
}
