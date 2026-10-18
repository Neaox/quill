import type { ChunkPlan, ChunkSpan } from './chunk-plan.ts'
import { looseText, referenceKey } from './chunk-plan.ts'

export type { ChunkPlan, ChunkSizes } from './chunk-plan.ts'
export { CHUNK_SIZES, planChunks } from './chunk-plan.ts'
export { normaliseMarkdown } from './normalise.ts'

/**
 * The order the pieces of a long document are parsed in, and when each one's
 * blocks are final (quill-plan.md section 31).
 *
 * A reducer over results, with no clock and no workers of its own, so the
 * same schedule drives a pool of workers in the browser, the page's own slow
 * path, and the property tests that prove a document parsed in pieces is the
 * document parsed whole (`parse-chunk.test.ts`).
 *
 * Every piece is parsed once on its own, in document order. That parse is
 * final for a piece that mentions no reference another piece could define,
 * which is nearly every piece of nearly every document, and its blocks are
 * delivered the moment every piece before them has been. Two things can
 * delay a piece:
 *
 * - **It ran on.** Its last block reached the end of the piece, so something
 *   the scan believed closed was not (`chunk-plan.ts`). It is joined to the
 *   next piece and parsed again; nothing after it has been delivered, and
 *   nothing before it depended on it.
 * - **It borrows a definition.** It mentions a reference defined, perhaps, in
 *   another piece. Once every piece has been parsed and none ran on, the
 *   definitions found are the document's, and the piece is parsed again with
 *   the ones it mentions written beside it, then taken out of its tree.
 *
 * Where a borrowed definition is written matters, because micromark does not
 * see every definition from everywhere. It reads the text of a block only
 * after the blocks around it, but the content of a `:::` container one level
 * at a time: a definition inside a container is known to text nested as deep
 * as it, and to shallower text only after it. So a definition is written
 * before the piece if it came from a piece before, after it if from a piece
 * after, and inside as many containers as it sat in.
 */

/** A definition a piece's parse found: a link reference's, or a footnote's. */
export interface ChunkDefinition {
  /** The label as written, which is what is written beside a piece that borrows it. */
  readonly label: string
  readonly footnote: boolean
  /** How many `:::` containers it sits in. */
  readonly depth: number
}

/**
 * Blocks written before and after a piece to carry the definitions it
 * borrows, taken out again after it is parsed.
 */
export interface BorrowedDefinitions {
  readonly before: number
  readonly after: number
}

/** The container a borrowed definition is written in, to sit as deep as it did. */
export const BORROWED_CONTAINER = 'borrowed-definition'

/** One parse: the text, and where in the document its lines and offsets are. */
export interface ChunkJob {
  readonly id: number
  readonly text: string
  /** Added to every line the parse reports, to make it the document's. */
  readonly line: number
  /** Added to every offset the parse reports. */
  readonly offset: number
  readonly borrowed: BorrowedDefinitions | undefined
  /** Blank lines between the piece and the block before it in another piece; undefined for none. */
  readonly blankLinesBefore: number | undefined
}

export interface ChunkResult<Payload> {
  readonly id: number
  readonly definitions: readonly ChunkDefinition[]
  /** The piece's last block ran to its end: it was cut inside something. */
  readonly endsOpen: boolean
  readonly payload: Payload
}

export interface ChunkDelivery<Payload> {
  readonly payload: Payload
  /** How much of the document has been delivered, from 0 to 1. */
  readonly progress: number
}

export interface ChunkSchedule<Payload> {
  /** The next parse to run, or undefined until a result arrives. */
  next(): ChunkJob | undefined
  /** Takes a parse's result; returns the pieces it made final, in document order. */
  settle(result: ChunkResult<Payload>): readonly ChunkDelivery<Payload>[]
  /** Every piece has been delivered. */
  readonly finished: boolean
}

interface Parse<Payload> {
  readonly id: number
  result: ChunkResult<Payload> | undefined
}

interface Piece<Payload> {
  readonly start: number
  readonly end: number
  readonly line: number
  /**
   * The references other pieces could define that this one mentions — even
   * one it could define itself, because a line that looks like a definition
   * may turn out to be code or prose.
   */
  readonly borrows: ReadonlySet<string>
  /** Its parse on its own: final unless it borrows. */
  alone: Parse<Payload> | undefined
  /** Its parse beside the definitions it borrows. */
  beside: Parse<Payload> | undefined
}

/**
 * A definition written beside a piece: only its label matters, so the address
 * is a placeholder, inside as many containers as it sat in, each with more
 * colons than the one inside it.
 */
function definitionBlock(definition: ChunkDefinition): string {
  const line = `[${definition.footnote ? '^' : ''}${definition.label}]: x`
  const fences = Array.from({ length: definition.depth }, (_, level) =>
    ':'.repeat(3 + definition.depth - 1 - level),
  )
  return [
    ...fences.map((fence) => `${fence}${BORROWED_CONTAINER}`),
    line,
    ...fences.toReversed(),
  ].join('\n')
}

interface Borrowed {
  readonly definition: ChunkDefinition
  /** Found in a piece before the one borrowing it. */
  readonly before: boolean
}

/**
 * How many blank lines stand between the piece starting at `start` and the
 * block before it, or undefined when nothing does. The parser records a count
 * other than one on the block (`source-form.ts`), and the block before is in
 * another piece, so the piece is told.
 */
function blankLinesBefore(source: string, start: number): number | undefined {
  let newlines = 0
  for (let at = start - 1; at >= 0; at -= 1) {
    const char = source.charAt(at)
    if (char === '\n') newlines += 1
    else if (char !== ' ' && char !== '\t') return newlines - 1
  }
  return undefined
}

/** A piece made from consecutive spans, knowing what the rest of the document could define. */
function pieceOf<Payload>(
  plan: ChunkPlan,
  spans: readonly ChunkSpan[],
  elsewhere: ReadonlySet<string>,
): Piece<Payload> {
  const first = spans[0]
  const last = spans.at(-1)
  /* v8 ignore next -- a piece is made from one span or more. */
  if (first === undefined || last === undefined) throw new Error('A piece needs a span.')
  const text = elsewhere.size === 0 ? '' : looseText(plan.source.slice(first.start, last.end))
  return {
    start: first.start,
    end: last.end,
    line: first.line,
    borrows: new Set([...elsewhere].filter((key) => text.includes(key))),
    alone: undefined,
    beside: undefined,
  }
}

export function createChunkSchedule<Payload>(plan: ChunkPlan): ChunkSchedule<Payload> {
  /** The spans each piece was made from, kept so a piece can be joined to the next. */
  const groups: ChunkSpan[][] = plan.spans.map((span) => [span])
  const definedBy = (except: number): Set<string> =>
    new Set(
      groups.flatMap((group, index) =>
        index === except ? [] : group.flatMap((s) => s.definitions),
      ),
    )
  const pieces: Piece<Payload>[] = groups.map((group, index) =>
    pieceOf(plan, group, definedBy(index)),
  )
  const total = Math.max(plan.source.length, 1)
  let delivered = 0
  let ids = 0

  const isLast = (index: number) => index === pieces.length - 1
  const isSound = (piece: Piece<Payload>, index: number) =>
    piece.alone?.result !== undefined && (!piece.alone.result.endsOpen || isLast(index))
  const allSound = () => pieces.every((piece, index) => isSound(piece, index))

  /** The definitions every other piece was found to hold that this one mentions. */
  const borrowedBy = (index: number): Borrowed[] => {
    const piece = pieces[index]
    /* v8 ignore next -- asked only of a piece the schedule holds. */
    if (piece === undefined) return []
    const found = new Map<string, Borrowed>()
    for (const [other, { alone }] of pieces.entries()) {
      if (other === index) continue
      /* v8 ignore next -- asked only once every piece has been parsed. */
      for (const definition of alone?.result?.definitions ?? []) {
        const key = referenceKey(definition.label, definition.footnote)
        const where = `${key} ${String(definition.depth)} ${String(other < index)}`
        if (piece.borrows.has(key) && !found.has(where)) {
          found.set(where, { definition, before: other < index })
        }
      }
    }
    return [...found.values()]
  }

  const job = (piece: Piece<Payload>, borrowed: readonly Borrowed[]): ChunkJob => {
    ids += 1
    const own = plan.source.slice(piece.start, piece.end)
    const blankLines = blankLinesBefore(plan.source, piece.start)
    if (borrowed.length === 0) {
      return {
        id: ids,
        text: own,
        line: piece.line,
        offset: piece.start,
        borrowed: undefined,
        blankLinesBefore: blankLines,
      }
    }
    const written = (side: readonly Borrowed[]) =>
      side.map(({ definition }) => definitionBlock(definition)).join('\n\n')
    const earlier = borrowed.filter((entry) => entry.before)
    const later = borrowed.filter((entry) => !entry.before)
    // A piece starts on a fresh line, so what goes before it stands apart;
    // only the first piece borrows nothing from before, which keeps its
    // front matter first. A piece that borrows from after is not the last,
    // so it ends on a blank line, and what goes after stands apart too.
    const before = earlier.length === 0 ? '' : `${written(earlier)}\n\n`
    const after = later.length === 0 ? '' : `\n${written(later)}\n`
    return {
      id: ids,
      text: `${before}${own}${after}`,
      line: piece.line - (before.split('\n').length - 1),
      offset: piece.start - before.length,
      borrowed: { before: earlier.length, after: later.length },
      blankLinesBefore: blankLines,
    }
  }

  /** The blocks of a piece, once they are final. */
  const finalOf = (piece: Piece<Payload>, index: number): ChunkResult<Payload> | undefined => {
    if (!isSound(piece, index)) return undefined
    if (piece.borrows.size === 0) return piece.alone?.result
    if (!allSound()) return undefined
    if (piece.beside === undefined && borrowedBy(index).length === 0) return piece.alone?.result
    return piece.beside?.result
  }

  const deliveries = (): ChunkDelivery<Payload>[] => {
    const out: ChunkDelivery<Payload>[] = []
    for (let piece = pieces[delivered]; piece !== undefined; piece = pieces[delivered]) {
      const result = finalOf(piece, delivered)
      if (result === undefined) break
      out.push({ payload: result.payload, progress: piece.end / total })
      delivered += 1
    }
    return out
  }

  /** Joins a piece that ran on to the one after it, to be parsed again together. */
  const join = (index: number): void => {
    /* v8 ignore next -- a piece that runs on is never the last, so there is one after it. */
    const group = [...(groups[index] ?? []), ...(groups[index + 1] ?? [])]
    groups.splice(index, 2, group)
    pieces.splice(index, 2, pieceOf(plan, group, definedBy(index)))
  }

  const find = (
    id: number,
  ): { piece: Piece<Payload>; index: number; parse: Parse<Payload> } | undefined => {
    for (const [index, piece] of pieces.entries()) {
      for (const parse of [piece.alone, piece.beside]) {
        if (parse?.id === id) return { piece, index, parse }
      }
    }
    return undefined
  }

  return {
    next() {
      const unparsed = pieces.findIndex((piece) => piece.alone === undefined)
      const waiting = pieces[unparsed]
      if (waiting !== undefined) {
        const next = job(waiting, [])
        waiting.alone = { id: next.id, result: undefined }
        return next
      }
      if (!allSound()) return undefined
      for (const [index, piece] of pieces.entries()) {
        if (index < delivered || piece.beside !== undefined || piece.borrows.size === 0) continue
        const borrowed = borrowedBy(index)
        if (borrowed.length === 0) continue
        const next = job(piece, borrowed)
        piece.beside = { id: next.id, result: undefined }
        return next
      }
      return undefined
    },
    settle(result) {
      const found = find(result.id)
      // A parse of a piece since joined to another is no longer wanted.
      if (found === undefined) return []
      found.parse.result = result
      if (found.parse === found.piece.alone && result.endsOpen && !isLast(found.index)) {
        join(found.index)
      }
      return deliveries()
    },
    get finished() {
      return delivered === pieces.length
    },
  }
}
