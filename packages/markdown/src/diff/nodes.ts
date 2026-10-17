import type { Properties } from 'hast'
import type { Node, Parent, PhrasingContent } from 'mdast'

import type { LineChange } from './lines.ts'

/**
 * The nodes a comparison adds to a tree, so the renderer can draw it.
 *
 * A comparison is drawn by the same renderer and the same handlers a reader's
 * page is (rule 16: one template per concept), from a tree that is the newer
 * document with the older one's removals put back and every difference
 * marked. These are the marks. They exist only in a comparison tree, which is
 * built in memory and never parsed, serialised or stored: no Markdown writes
 * them and no author can.
 */

/** Words that the newer revision added, inside a block that both have. */
export interface DiffInsertion extends Parent {
  type: 'diffInsertion'
  children: PhrasingContent[]
}

/** Words that the newer revision removed, inside a block that both have. */
export interface DiffDeletion extends Parent {
  type: 'diffDeletion'
  children: PhrasingContent[]
}

/**
 * A code block whose lines changed, drawn line by line. A code block is
 * compared by line (ADR-021's amendment), and a line is the unit a developer
 * reads a change to code in.
 */
export interface DiffCode extends Node {
  type: 'diffCode'
  lang?: string | null | undefined
  lines: readonly LineChange[]
}

declare module 'mdast' {
  interface PhrasingContentMap {
    diffInsertion: DiffInsertion
    diffDeletion: DiffDeletion
  }
  interface BlockContentMap {
    diffCode: DiffCode
  }
  interface RootContentMap {
    diffInsertion: DiffInsertion
    diffDeletion: DiffDeletion
    diffCode: DiffCode
  }
}

/** What happened to a block, as the renderer marks it. */
export type BlockChange = 'added' | 'removed' | 'changed' | 'moved'

/**
 * The attributes a marked block carries into the HTML. `data-change` is what
 * the stylesheet draws the margin marker from; `data-change-id` is what the
 * list of changes and next/previous jump to; `data-side` tells the two halves
 * of a before-and-after apart.
 */
export interface BlockMark {
  readonly change: BlockChange
  readonly id?: string | undefined
  readonly side?: 'before' | 'after' | undefined
}

export function markProperties(mark: BlockMark): Properties {
  return {
    'data-change': mark.change,
    ...(mark.id === undefined ? {} : { 'data-change-id': mark.id }),
    ...(mark.side === undefined ? {} : { 'data-side': mark.side }),
  }
}

/** A copy of a node carrying a block mark, so the renderer emits it as attributes. */
export function marked<T extends Node>(node: T, mark: BlockMark): T {
  return {
    ...node,
    data: {
      ...node.data,
      hProperties: { ...node.data?.hProperties, ...markProperties(mark) },
    },
  }
}
