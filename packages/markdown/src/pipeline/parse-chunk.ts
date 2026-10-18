import type { Root, RootContent } from 'mdast'

import { planChunks } from './chunk-plan.ts'
import type { ChunkSizes } from './chunk-plan.ts'
import { BORROWED_CONTAINER, createChunkSchedule } from './chunk-schedule.ts'
import type { ChunkDefinition, ChunkJob, ChunkResult } from './chunk-schedule.ts'
import { normaliseMarkdown } from './normalise.ts'
import { parseNormalised } from './processor.ts'
import { withForm } from './source-form.ts'

/**
 * Parsing one piece of a long document as the document's own blocks
 * (`chunk-plan.ts`, `chunk-schedule.ts`): the whole pipeline over the piece,
 * the borrowed definitions taken out again, and every position moved to where
 * the piece sits in the document, so the blocks are the very ones a parse of
 * the whole would have made.
 */

type Position = NonNullable<Root['position']>
type Point = Position['start']

export interface ReadChunk {
  readonly children: RootContent[]
  /** Where the piece ends in the document: the root's end, when it is the last. */
  readonly end: Point
}

/** Any node of the tree, read only as far as positions and definitions need. */
interface Walked {
  readonly type: string
  readonly position?: Position | undefined
  readonly label?: string | null | undefined
  readonly identifier?: string
  readonly syntax?: string
  readonly data?: object | undefined
  readonly children?: readonly Walked[]
}

/**
 * A summary read out of a `<details>` tag (`details/read.ts`): its inline
 * nodes come from parsing the tag's text on its own, so their positions are
 * the tag's, not the document's, in a whole parse as in a piece.
 */
function isReadSummary(node: Walked, parent: Walked): boolean {
  return (
    parent.type === 'details' &&
    parent.syntax === 'html' &&
    node.position === undefined &&
    node.data !== undefined &&
    'directiveLabel' in node.data &&
    node.data.directiveLabel === true
  )
}

function shiftPoint(point: Point, line: number, offset: number): void {
  point.line += line
  if (point.offset !== undefined) point.offset += offset
}

/** Moves every position under `nodes` by whole lines, each once even where two nodes share one. */
function shiftPositions(nodes: readonly Walked[], line: number, offset: number): void {
  if (line === 0 && offset === 0) return
  const moved = new WeakSet<Position>()
  const stack = [...nodes]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    const { position } = node
    if (position !== undefined && !moved.has(position)) {
      moved.add(position)
      shiftPoint(position.start, line, offset)
      shiftPoint(position.end, line, offset)
    }
    for (const child of node.children ?? []) {
      if (!isReadSummary(child, node)) stack.push(child)
    }
  }
}

/** Every definition under `nodes`, and how many `:::` containers each sits in. */
function definitionsIn(nodes: readonly Walked[]): ChunkDefinition[] {
  const found: ChunkDefinition[] = []
  const stack = nodes.map((node) => ({ node, depth: 0 }))
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    const { node, depth } = entry
    if (node.type === 'definition' || node.type === 'footnoteDefinition') {
      found.push({
        /* v8 ignore next -- the parser gives every definition its label. */
        label: node.label ?? node.identifier ?? '',
        footnote: node.type === 'footnoteDefinition',
        depth,
      })
    }
    const inner = node.type === 'containerDirective' ? depth + 1 : depth
    for (const child of node.children ?? []) stack.push({ node: child, depth: inner })
  }
  return found
}

/** Where the piece's last line with anything on it ends. */
function contentEnd(text: string): number {
  let end = text.length
  for (let at = end - 1; at >= 0; at -= 1) {
    const char = text.charAt(at)
    if (char === '\n') end = at
    else if (char !== ' ' && char !== '\t') break
  }
  return end
}

/** A block written to carry a borrowed definition: the definition, or a container holding it. */
function isBorrowed(node: RootContent): boolean {
  return (
    node.type === 'definition' ||
    node.type === 'footnoteDefinition' ||
    (node.type === 'containerDirective' && node.name === BORROWED_CONTAINER)
  )
}

/** The borrowed definitions taken out of the piece's blocks, after checking they are those. */
function withoutBorrowed(children: RootContent[], job: ChunkJob): RootContent[] {
  const { borrowed } = job
  if (borrowed === undefined) return children
  const end = children.length - borrowed.after
  const taken = [...children.slice(0, borrowed.before), ...children.slice(end)]
  if (end < borrowed.before || !taken.every((node) => isBorrowed(node))) {
    throw new Error('The borrowed definitions did not parse as definitions.')
  }
  return children.slice(borrowed.before, end)
}

/** Parses one piece of the document; the result is the schedule's. */
export function readChunk(job: ChunkJob): ChunkResult<ReadChunk> {
  const tree = parseNormalised(job.text)
  // Read in the piece's own offsets, before they become the document's.
  const last = tree.children.at(-1)?.position?.end.offset
  const endsOpen = job.borrowed === undefined && last !== undefined && last > contentEnd(job.text)
  const children = withoutBorrowed(tree.children, job)
  shiftPositions(children, job.line, job.offset)
  // The parser counted the blank lines before every block but the first,
  // whose block before is in the piece before.
  const [first] = children
  const blankLines = job.blankLinesBefore
  if (first !== undefined && blankLines !== undefined && blankLines !== 1) {
    withForm(first, { blankLines })
  }
  /* v8 ignore next -- a parsed root always has its position. */
  const end = structuredClone(tree.position?.end ?? { line: 1, column: 1, offset: 0 })
  shiftPoint(end, job.line, job.offset)
  return {
    id: job.id,
    definitions: definitionsIn(children),
    endsOpen,
    payload: { children, end },
  }
}

/**
 * Parses a document piece by piece, one after another: the same tree as
 * `parseMarkdown`, which is what the property tests hold it to, and the
 * path a page with no workers takes.
 */
export function parseMarkdownInChunks(markdown: string, sizes?: ChunkSizes): Root {
  const plan = planChunks(normaliseMarkdown(markdown), sizes)
  const schedule = createChunkSchedule<ReadChunk>(plan)
  const children: RootContent[] = []
  let end: Point = { line: 1, column: 1, offset: 0 }
  for (let job = schedule.next(); job !== undefined; job = schedule.next()) {
    for (const { payload } of schedule.settle(readChunk(job))) {
      children.push(...payload.children)
      end = payload.end
    }
  }
  /* v8 ignore next -- every piece the schedule asks for is parsed, so it always finishes. */
  if (!schedule.finished) throw new Error('The schedule stopped before the end of the document.')
  return { type: 'root', children, position: { start: { line: 1, column: 1, offset: 0 }, end } }
}
