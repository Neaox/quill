import type { Extensions, NodeConfig } from '@tiptap/core'

import { TableView } from './table-view.ts'

const withView: Partial<NodeConfig> = {
  addNodeView:
    () =>
    ({ node, editor, getPos }) =>
      new TableView(node, editor.view, getPos),
}

/** Gives tables their editing view: scroller, column group and handles (ADR-040). */
export function withTableViews(extensions: Extensions): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'table'
      ? extension.extend(withView)
      : extension,
  )
}
