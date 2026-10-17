/**
 * Where a long Markdown document can be cut so that every piece parses on its
 * own exactly as it parses inside the whole (quill-plan.md section 31: a large
 * paste lands in batches, the first screenful long before the last).
 *
 * A cut goes after a blank line whose next line starts a fresh paragraph or
 * heading at the left margin — a letter, a digit that is not a list marker,
 * or `#` — because after a blank line such a line closes every list, quote,
 * footnote and indented block that was open, and nothing before it can reach
 * past it. Only three things carry a blank line and an unindented line inside
 * them, and the scan follows each so it never cuts inside one: a fence (code,
 * or a `:::` directive container, which code groups and spaced VitePress
 * groups are too), a raw HTML block that ends at a closing marker rather than
 * a blank line (`<!-- … -->`, `<script>`, `<pre>` and the rest), and front
 * matter.
 *
 * GitHub's `<details>` is read after parsing, from the raw HTML around it
 * (`details/read.ts`), and all at once: if the tags of one level do not
 * balance, none of that level is read. So the scan never cuts between the
 * first line that could hold such a tag and the last, and the reader decides
 * over one piece what it would have decided over the whole.
 *
 * The scan errs one way only. Where it cannot be sure — an HTML block inside
 * another, an indented fence that might be a list item's — it keeps going
 * without a cut, which costs speed and never correctness, and the one case it
 * could still get wrong, a fence it thought closed, is caught when the piece is
 * parsed: its last block runs to the end of the piece, and the piece is joined
 * to the next (`chunk-schedule.ts`).
 *
 * References are the other thing that reaches across a cut: `[text][label]`
 * is a link only if `[label]: url` is defined somewhere in the document. The
 * scan collects every line that could define one, in any container, so the
 * schedule knows which pieces need to hear about definitions in other pieces.
 */

/** A piece of the source: `[start, end)`, starting on line `line` (zero-based). */
export interface ChunkSpan {
  readonly start: number
  readonly end: number
  readonly line: number
  /**
   * The references this piece could define, as `referenceKey` writes them: a
   * superset of what the parser will find, because a line can look like a
   * definition and turn out to be prose.
   */
  readonly definitions: readonly string[]
}

export interface ChunkPlan {
  /** The normalised source the spans index (`normaliseMarkdown`). */
  readonly source: string
  readonly spans: readonly ChunkSpan[]
}

/** How long a piece grows before it is cut, in characters: the first short, so it lands soon. */
export interface ChunkSizes {
  readonly first: number
  readonly rest: number
}

/**
 * The first piece is about a screenful, so it is on screen within a frame or
 * two of the worker starting; the rest are large enough that a message per
 * piece costs nothing, and small enough that four workers share a long paste.
 */
export const CHUNK_SIZES: ChunkSizes = { first: 4_096, rest: 16_384 }

const BLANK = /^[ \t]*$/u

/** A line that, after a blank line, can only start a new paragraph or heading. */
const FRESH_START = /^(?:#|\p{L}|\d(?!\d{0,8}[.)](?:[ \t]|$)))/u

/** A fence's opening run; a backtick fence's info string may not hold a backtick. */
const FENCE_OPEN = /^ {0,3}(?<fence>`{3,}(?=[^`]*$)|~{3,})/u
const COLONS_OPEN = /^ {0,3}(?<colons>:{3,})[ \t]*[^:\s]/u
const COLONS_CLOSE = /^ {0,3}(?<colons>:{3,})[ \t]*$/u
const FRONT_MATTER_FENCE = /^---[ \t]*$/u

/** Raw HTML blocks that end at a marker, not a blank line, with the marker that ends each. */
const HTML_WITH_END: readonly (readonly [RegExp, RegExp])[] = [
  [/^ {0,3}<(?:script|pre|style|textarea)(?:[\s>]|$)/iu, /<\/(?:script|pre|style|textarea)>/iu],
  [/^ {0,3}<!--/u, /-->/u],
  [/^ {0,3}<\?/u, /\?>/u],
  [/^ {0,3}<![A-Za-z]/u, />/u],
  [/^ {0,3}<!\[CDATA\[/u, /\]\]>/u],
]

/** A line that could hold a tag `details/read.ts` reads, wherever it sits. */
const DETAILS_TAG = /^\s*<(?:details|\/details|summary)/u

/** Container markers a definition can sit behind: quotes and list items, nested. */
const CONTAINERS = String.raw`(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*`
const LABEL = String.raw`(?:[^\\\[\]]|\\.)+`
const DEFINITION = new RegExp(String.raw`^${CONTAINERS}\[(\^?)(${LABEL})\]:`, 'su')
/** A line that opens a bracket it does not close: a label that may go on to the next line. */
const OPEN_LABEL = new RegExp(String.raw`^${CONTAINERS}\[(?:[^\\\[\]]|\\.)*$`, 'u')
/** How far a label may run on: CommonMark's 999 characters. */
const LABEL_LIMIT = 999

/**
 * A reference as it appears in source with everything but letters, digits,
 * brackets and carets taken out, so the same reference matches however its
 * whitespace, case, container markers or punctuation fall.
 */
function loose(text: string): string {
  return text
    .toLowerCase()
    .toUpperCase()
    .replaceAll(/[^\p{L}\p{N}[\]^]/gu, '')
}

/**
 * The key a reference is known by in this module: `[LABEL]` or `[^LABEL]`,
 * loosened. Whether a piece mentions a reference is then a substring test on
 * the loosened piece, which can say yes wrongly but never no wrongly.
 */
export function referenceKey(label: string, footnote: boolean): string {
  return `[${footnote ? '^' : ''}${loose(label)}]`
}

/** The piece's text as `referenceKey` keys are found in it. */
export function looseText(text: string): string {
  return loose(text)
}

interface ScanState {
  /** The line that closes the fence open, if one is. */
  fence: RegExp | undefined
  htmlEnd: RegExp | undefined
  frontMatter: boolean
  /** Colon counts of the directive containers open, innermost last. */
  readonly directives: number[]
}

/** Whether a cut after this point would leave nothing open across it. */
function isClear(state: ScanState): boolean {
  return (
    state.fence === undefined &&
    state.htmlEnd === undefined &&
    !state.frontMatter &&
    state.directives.length === 0
  )
}

/** Reads one line outside any fence, raw HTML or front matter. */
function readOpenLine(state: ScanState, line: string): void {
  // Most lines are prose: only these characters can open or close anything,
  // and the scan runs on the main thread, so the rest are passed over cheaply.
  const lead = line.trimStart().charAt(0)
  if (lead !== '`' && lead !== '~' && lead !== ':' && lead !== '<') return
  const marker = FENCE_OPEN.exec(line)?.groups?.['fence']
  if (marker !== undefined) {
    // Backticks and tildes need no escaping in a pattern.
    const closer = String.raw`^ {0,3}${marker.charAt(0)}{${String(marker.length)},}[ \t]*$`
    state.fence = new RegExp(closer, 'u')
    return
  }
  const closing = COLONS_CLOSE.exec(line)?.groups?.['colons']
  if (closing !== undefined) {
    const innermost = state.directives.at(-1)
    if (innermost !== undefined && closing.length >= innermost) state.directives.pop()
    return
  }
  const opening = COLONS_OPEN.exec(line)?.groups?.['colons']
  if (opening !== undefined) {
    state.directives.push(opening.length)
    return
  }
  for (const [start, end] of HTML_WITH_END) {
    if (start.test(line)) {
      // The marker may close it on the same line, after the opening.
      if (!end.test(line.replace(start, ''))) state.htmlEnd = end
      return
    }
  }
}

/** Advances the scan over one line. */
function readLine(state: ScanState, line: string, index: number): void {
  if (index === 0 && FRONT_MATTER_FENCE.test(line)) {
    state.frontMatter = true
    return
  }
  if (state.frontMatter) {
    if (FRONT_MATTER_FENCE.test(line)) state.frontMatter = false
    return
  }
  if (state.fence !== undefined) {
    if (state.fence.test(line)) state.fence = undefined
    return
  }
  if (state.htmlEnd !== undefined) {
    if (state.htmlEnd.test(line)) state.htmlEnd = undefined
    return
  }
  if (!BLANK.test(line)) readOpenLine(state, line)
}

/** The definitions a line could start, reading on into the next lines for a label that wraps. */
function definitionsAt(lines: readonly string[], line: string, index: number): string[] {
  if (!line.includes('[')) return []
  let text = line
  if (OPEN_LABEL.test(line)) {
    for (const following of lines.slice(index + 1)) {
      if (BLANK.test(following) || text.length >= LABEL_LIMIT) break
      text += `\n${following}`
      if (following.includes(']')) break
    }
  }
  const match = DEFINITION.exec(text)
  if (match === null) return []
  /* v8 ignore next -- the label's group is not optional, so a match always has it. */
  return [referenceKey(match[2] ?? '', match[1] === '^')]
}

/**
 * Cuts `source` (already normalised: `\n` line endings) into spans of about
 * `sizes` characters at the points described above. The spans cover the
 * source exactly, in order; a source with no safe point is one span.
 */
export function planChunks(source: string, sizes: ChunkSizes = CHUNK_SIZES): ChunkPlan {
  const lines = source.split('\n')
  const spans: ChunkSpan[] = []
  const state: ScanState = {
    fence: undefined,
    htmlEnd: undefined,
    frontMatter: false,
    directives: [],
  }
  // Every line, in a fence or not: the reader's decision is over raw HTML,
  // and a line the scan wrongly took for code must not hide a tag from it.
  const firstDetails = lines.findIndex((line) => DETAILS_TAG.test(line))
  const lastDetails = lines.findLastIndex((line) => DETAILS_TAG.test(line))
  let start = 0
  let startLine = 0
  let definitions: string[] = []
  let offset = 0
  for (const [index, line] of lines.entries()) {
    readLine(state, line, index)
    // Every line, in a fence or not, for the same reason: a fence the scan
    // got wrong must not hide a definition.
    definitions.push(...definitionsAt(lines, line, index))
    const end = offset + line.length + 1
    const next = lines[index + 1]
    const target = spans.length === 0 ? sizes.first : sizes.rest
    if (
      end - start >= target &&
      next !== undefined &&
      BLANK.test(line) &&
      FRESH_START.test(next) &&
      isClear(state) &&
      !(firstDetails <= index && index < lastDetails)
    ) {
      spans.push({ start, end, line: startLine, definitions })
      start = end
      startLine = index + 1
      definitions = []
    }
    offset = end
  }
  spans.push({ start, end: source.length, line: startLine, definitions })
  return { source, spans }
}
