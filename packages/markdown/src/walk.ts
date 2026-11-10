/**
 * Visits every node of a tree, depth first and in document order, the
 * parent before its children: the order `unist-util-visit` visits in.
 *
 * It exists because the renderer walks every body many times (links,
 * outline, text, slots, fragment links, emoji, drawings), and
 * `unist-util-visit` builds a closure and a parent stack for every node it
 * visits, which made those walks most of a render's cost after the parse
 * (ADR-062, step 3). This keeps no stack and makes nothing per node.
 *
 * The visitor may change the node it is given, including its `children`:
 * the walk reads them after the visitor returns, as `unist-util-visit` does.
 * Returning `true` skips the node's children.
 */

/**
 * What a walk needs of a node: a type, and children of the same union (mdast's
 * `Nodes` and hast's `Nodes` both are).
 */
export interface WalkNode<N> {
  readonly type: string
  readonly children?: readonly N[]
}

export type Walker<N> = (node: N) => boolean | void

export function walk<N extends WalkNode<N>>(tree: N, visitor: Walker<N>): void {
  if (visitor(tree) === true) return
  // Read once the visitor is done with the node.
  const { children } = tree
  if (children === undefined) return
  for (const child of children) walk(child, visitor)
}
