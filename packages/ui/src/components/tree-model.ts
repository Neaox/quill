/**
 * The document tree's bookkeeping, apart from its markup (`tree.tsx`): where a
 * node sits, which slice of a long branch is drawn, and what a person opened
 * by hand. Pure functions over the nodes, so each rule is tested on its own.
 *
 * The tree draws only what is visible — a collapsed node's children are not
 * rendered at all, and a branch of thousands of siblings draws one page of
 * them with "Show more" — because a workspace holds tens of thousands of
 * documents and every drawn row is a router link and a menu trigger.
 */

/** The parts of a node the bookkeeping reads. */
export interface TreeModelNode {
  readonly id: string
  /** The children that are loaded: all of them, or a slice of them (`childrenOffset`). */
  readonly children?: readonly TreeModelNode[] | undefined
  /** Where `children` starts among all of the node's children, when it is a slice. */
  readonly childrenOffset?: number | undefined
  readonly current?: boolean | undefined
}

export interface TreeModelSection {
  readonly id: string
  readonly nodes: readonly TreeModelNode[]
  /** Where `nodes` starts among all of the section's top-level documents, when it is a slice. */
  readonly nodesOffset?: number | undefined
}

/**
 * A branch is keyed by what owns it: a section's top level, or a node's
 * children. One namespace for both, so one map holds every open/closed choice.
 */
export function sectionKey(sectionId: string): string {
  return `section:${sectionId}`
}

export function nodeKey(nodeId: string): string {
  return `node:${nodeId}`
}

/** Where a node sits: everything to open to show it, and its place in each branch on the way. */
export interface TreePath {
  /** The branch keys to open, the section first, then each ancestor outermost first. */
  readonly open: readonly string[]
  /** Branch key → the index, in that branch, of the node or ancestor the path passes through. */
  readonly positions: ReadonlyMap<string, number>
  /** The branch the node itself is in: the last of the way down. */
  readonly deepest: string
}

/** The first node `matches` accepts, as a path; a depth-first walk that stops when it finds it. */
export function findPath(
  sections: readonly TreeModelSection[],
  matches: (node: TreeModelNode) => boolean,
): TreePath | undefined {
  for (const section of sections) {
    const open = [sectionKey(section.id)]
    const positions = new Map<string, number>()
    let deepest = sectionKey(section.id)
    const walk = (nodes: readonly TreeModelNode[], branch: string, offset: number): boolean => {
      for (const [index, node] of nodes.entries()) {
        if (matches(node)) {
          positions.set(branch, offset + index)
          deepest = branch
          return true
        }
        if (node.children !== undefined && node.children.length > 0) {
          const key = nodeKey(node.id)
          open.push(key)
          if (walk(node.children, key, node.childrenOffset ?? 0)) {
            positions.set(branch, offset + index)
            return true
          }
          open.pop()
        }
      }
      return false
    }
    if (walk(section.nodes, sectionKey(section.id), section.nodesOffset ?? 0)) {
      return { open, positions, deepest }
    }
  }
  return undefined
}

/** The slice of a branch that is drawn: `[start, end)`. */
export interface TreeWindow {
  readonly start: number
  readonly end: number
}

/**
 * Which children of a branch to draw.
 *
 * A window somebody widened with "Show more" stands. Otherwise the first page,
 * unless the path to the open document passes through this branch further
 * down — then the page that holds it, so the document being read is always in
 * the sidebar without drawing the thousands of siblings before it.
 */
export function windowFor(
  length: number,
  pageSize: number,
  chosen: TreeWindow | undefined,
  position: number | undefined,
  context?: number | undefined,
): TreeWindow {
  if (chosen !== undefined) {
    return { start: Math.min(chosen.start, length), end: Math.min(chosen.end, length) }
  }
  // An ancestor's level shows the way down and a few rows either side of it,
  // not a full page: a document twelve levels deep would otherwise draw a
  // page of siblings at every one of them.
  if (position !== undefined && context !== undefined) {
    return {
      start: Math.max(0, position - context),
      end: Math.min(length, position + context + 1),
    }
  }
  const start = position === undefined || position < pageSize ? 0 : position - (position % pageSize)
  return { start, end: Math.min(start + pageSize, length) }
}

/** How many rows either side of the way down an ancestor's level shows. */
export const ANCESTOR_CONTEXT = 3

/** Storage is per origin, so the prefix only has to keep clear of the app's other keys. */
const STORAGE_PREFIX = 'document-tree:'

function isChoice(value: unknown): value is readonly [string, boolean] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'boolean'
  )
}

/**
 * The branches opened or closed by hand, for this browser tab's session.
 *
 * `sessionStorage`, so it survives moving between pages and a reload but is
 * nobody's usage history; every access is guarded, because storage can be
 * blocked, full, or absent (a private window, a test), and the tree must draw
 * the same without it.
 */
export function readChoices(key: string): ReadonlyMap<string, boolean> {
  try {
    const raw = globalThis.sessionStorage?.getItem(`${STORAGE_PREFIX}${key}`)
    if (raw === null || raw === undefined) return new Map()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Map(parsed.filter(isChoice)) : new Map()
  } catch {
    return new Map()
  }
}

export function writeChoices(key: string, choices: ReadonlyMap<string, boolean>): void {
  try {
    globalThis.sessionStorage?.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify([...choices]))
  } catch {
    // Not remembered beyond this page; the tree works the same.
  }
}
