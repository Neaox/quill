import type { PhrasingContent } from 'mdast'

import type { DiffDeletion, DiffInsertion } from './nodes.ts'
import type { Change, Run } from './runs.ts'
import { changeRuns, isWord, tokenize } from './runs.ts'
import { nodeKey } from './keys.ts'

/**
 * Word-level changes inside one block, as phrasing content a renderer draws.
 *
 * Inline content is flattened to *atoms*: each word, space and punctuation
 * mark of a text node, carrying the formatting around it (emphasis, strong,
 * strikethrough, a link and its target), and every other inline node — code,
 * an image, a break, a directive — whole. The atoms are compared by their
 * text *and* their formatting, so making a word bold or changing where a link
 * points is a change, and then the tree is rebuilt with each change wrapped
 * outermost in a `diffInsertion` or `diffDeletion`.
 */

type Mark = Extract<
  PhrasingContent,
  { type: 'emphasis' | 'strong' | 'delete' | 'link' | 'linkReference' }
>

interface Atom {
  /** Text and formatting: two atoms with the same key read the same. */
  readonly key: string
  /** The formatting around it, outermost first, as the nodes it came from. */
  readonly marks: readonly Mark[]
  readonly leaf: PhrasingContent
  /** Characters a reader sees, for tidying the runs. */
  readonly weight: number
  readonly words: number
}

export interface MergedPhrasing {
  readonly children: PhrasingContent[]
  readonly wordsAdded: number
  readonly wordsRemoved: number
}

export function mergePhrasing(
  before: readonly PhrasingContent[],
  after: readonly PhrasingContent[],
): MergedPhrasing {
  const runs = changeRuns(atomsOf(before), atomsOf(after), (atom) => atom.key, {
    weight: (atom) => atom.weight,
  })
  const words = (change: Change) =>
    runs
      .filter((run) => run.change === change)
      .reduce((total, run) => total + run.items.reduce((sum, atom) => sum + atom.words, 0), 0)
  return {
    children: rebuild(runs),
    wordsAdded: words('added'),
    wordsRemoved: words('removed'),
  }
}

/** Phrasing wrapped whole as an addition or a removal: a block that only one side has. */
export function wholly(
  change: 'added' | 'removed',
  children: PhrasingContent[],
): PhrasingContent[] {
  if (children.length === 0) return []
  const wrapper: DiffInsertion | DiffDeletion =
    change === 'added' ? { type: 'diffInsertion', children } : { type: 'diffDeletion', children }
  return [wrapper]
}

/** Whether merged phrasing marks anything: its wrappers are always outermost. */
export function hasChanges(children: readonly PhrasingContent[]): boolean {
  return children.some((child) => child.type === 'diffInsertion' || child.type === 'diffDeletion')
}

function markKey(mark: Mark): string {
  switch (mark.type) {
    case 'link':
      return `a(${mark.url} ${mark.title ?? ''})`
    case 'linkReference':
      return `ar(${mark.identifier})`
    default:
      return mark.type
  }
}

function atomsOf(nodes: readonly PhrasingContent[], marks: readonly Mark[] = []): Atom[] {
  const context = marks.map(markKey).join('>')
  return nodes.flatMap((node): Atom[] => {
    switch (node.type) {
      case 'text':
        return tokenize(node.value).map((token) => ({
          key: `${context}|${token}`,
          marks,
          leaf: { type: 'text', value: token },
          weight: token.length,
          words: isWord(token) ? 1 : 0,
        }))
      case 'emphasis':
      case 'strong':
      case 'delete':
      case 'link':
      case 'linkReference':
        return atomsOf(node.children, [...marks, node])
      default: {
        const key = nodeKey(node)
        return [
          {
            key: `${context}|${key}`,
            marks,
            leaf: node,
            weight: Math.max(1, key.length / 4),
            words: 'value' in node && typeof node.value === 'string' ? 1 : 0,
          },
        ]
      }
    }
  })
}

/** A change's wrapper on the path of the atoms in its run: one object per run. */
interface RunWrapper {
  readonly type: 'run'
  readonly change: 'added' | 'removed'
}

type Step = Mark | RunWrapper

/** An open node in the rebuilt tree, and the step on the path that opened it. */
interface Open {
  readonly by: Step | null
  readonly children: PhrasingContent[]
}

/**
 * Rebuilds a phrasing tree from runs of atoms. Each atom's path is its run's
 * wrapper (for a change), then its marks; nodes stay open while consecutive
 * atoms share a prefix of that path *by identity*, so a sentence of emphasis
 * stays one `emphasis` rather than one per word, and two runs are never
 * merged into one wrapper.
 */
function rebuild(runs: readonly Run<Atom>[]): PhrasingContent[] {
  const root: Open = { by: null, children: [] }
  const stack: Open[] = [root]

  for (const run of runs) {
    const wrapper: RunWrapper | undefined =
      run.change === 'equal' ? undefined : { type: 'run', change: run.change }
    for (const atom of run.items) {
      const path: readonly Step[] = wrapper === undefined ? atom.marks : [wrapper, ...atom.marks]
      let shared = 0
      while (shared < path.length && stack[shared + 1]?.by === path[shared]) shared += 1
      stack.length = shared + 1
      for (const step of path.slice(shared)) {
        const children: PhrasingContent[] = []
        ;(stack.at(-1) ?? root).children.push(shell(step, children))
        stack.push({ by: step, children })
      }
      append((stack.at(-1) ?? root).children, atom.leaf)
    }
  }
  return root.children
}

/** An empty copy of a step's node, to be filled with the atoms under it. */
function shell(step: Step, children: PhrasingContent[]): PhrasingContent {
  switch (step.type) {
    case 'run':
      return step.change === 'added'
        ? { type: 'diffInsertion', children }
        : { type: 'diffDeletion', children }
    case 'emphasis':
    case 'strong':
    case 'delete':
      return { type: step.type, children }
    case 'link':
      return { type: 'link', url: step.url, title: step.title, children }
    case 'linkReference':
      return {
        type: 'linkReference',
        identifier: step.identifier,
        label: step.label,
        referenceType: step.referenceType,
        children,
      }
  }
}

/** Appends a leaf, joining neighbouring text so the tree stays as a parser would write it. */
function append(children: PhrasingContent[], leaf: PhrasingContent): void {
  const last = children.at(-1)
  if (last?.type === 'text' && leaf.type === 'text') {
    children[children.length - 1] = { type: 'text', value: last.value + leaf.value }
    return
  }
  children.push(leaf.type === 'text' ? { type: 'text', value: leaf.value } : leaf)
}
