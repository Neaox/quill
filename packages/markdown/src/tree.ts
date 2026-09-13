import type { Root, RootContent } from 'mdast'

/**
 * Replaces a node with zero or more nodes, or returns `undefined` to keep it.
 * The node has already had its own children rewritten, so a rewrite sees the
 * finished subtree. The parent's node type comes with it (`'root'` at the top),
 * because what a replacement is allowed to be depends on where it sits: a
 * paragraph belongs in flow content, a text node in phrasing content.
 */
export type NodeRewrite = (
  node: RootContent,
  parentType: string,
) => readonly RootContent[] | undefined

/** The shape every node shares. The tree may hold node types no mdast type describes. */
interface NodeLike {
  readonly type: string
  readonly children?: readonly NodeLike[]
}

function rewriteNode(
  node: NodeLike,
  parentType: string,
  rewrite: NodeRewrite,
): readonly NodeLike[] {
  const next =
    node.children === undefined
      ? node
      : {
          ...node,
          children: node.children.flatMap((child) => rewriteNode(child, node.type, rewrite)),
        }
  // The walk is structural so that unmodelled nodes survive it; `RootContent` is
  // the type every caller works in, and the two conversions are confined to here.
  return rewrite(next as RootContent, parentType) ?? [next]
}

/** Rewrites a whole document depth-first. Pure: the input tree is never mutated. */
export function rewriteTree(tree: Root, rewrite: NodeRewrite): Root {
  const children = tree.children.flatMap((child) => rewriteNode(child, tree.type, rewrite))
  return { ...tree, children: children as RootContent[] }
}
