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

/**
 * A node's subtree rewritten. A node whose children all came back as
 * themselves is returned as it is rather than copied: most rewrites change
 * nothing in most of a document, and copying every node on every pass was a
 * large part of a render's cost (ADR-062, step 3).
 */
function rewriteNode(
  node: NodeLike,
  parentType: string,
  rewrite: NodeRewrite,
): readonly NodeLike[] {
  const children = node.children === undefined ? undefined : rewriteChildren(node, rewrite)
  const next = children === undefined ? node : { ...node, children }
  // The walk is structural so that unmodelled nodes survive it; `RootContent` is
  // the type every caller works in, and the two conversions are confined to here.
  return rewrite(next as RootContent, parentType) ?? [next]
}

/** A node's children rewritten, or `undefined` when every one came back as itself. */
function rewriteChildren(node: NodeLike, rewrite: NodeRewrite): NodeLike[] | undefined {
  const { children = [] } = node
  let changed = false
  const rewritten: NodeLike[] = []
  for (const child of children) {
    const replaced = rewriteNode(child, node.type, rewrite)
    if (replaced.length !== 1 || replaced[0] !== child) changed = true
    rewritten.push(...replaced)
  }
  return changed ? rewritten : undefined
}

/**
 * Rewrites a whole document depth-first. Pure: the input tree is never
 * mutated. The result shares every subtree the rewrite left alone with the
 * input, and is the input itself when nothing changed.
 */
export function rewriteTree(tree: Root, rewrite: NodeRewrite): Root {
  const children = rewriteChildren(tree, rewrite)
  return children === undefined ? tree : { ...tree, children: children as RootContent[] }
}
