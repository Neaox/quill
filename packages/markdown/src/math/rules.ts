/**
 * What makes a dollar sign inline math, as against a dollar sign (ADR-064).
 *
 * `$` is the most ordinary character in documentation: prices, shell prompts,
 * variables. A rule that took any pair as maths would rewrite every document
 * that mentions two prices. These are Pandoc's rules, which GitHub also reads:
 * the dollar that opens has something that is not space after it, the one
 * that closes has something that is not space before it and no digit after,
 * and so `from $501 to $2,500` is prose.
 *
 * The rules are written once, here, and used twice: by the tokenizer
 * (`syntax.ts`), which reads a document, and by the writer (`escape.ts`),
 * which has to know which dollars in a tree's text would be read as maths
 * and escape exactly those. Two copies would drift, and a document would be
 * rewritten or, worse, change meaning on a save.
 */

const SPACE = /\s/u
const DIGIT = /\d/u

/** An empty string is the edge of the text, which counts as space. */
const isSpace = (character: string): boolean => character === '' || SPACE.test(character)

/** A dollar with `before` and `after` around it can open inline math. */
export function opensInlineMath(before: string, after: string): boolean {
  return before !== '$' && !isSpace(after) && after !== '$'
}

/** A dollar with `before` and `after` around it can close inline math. */
export function closesInlineMath(before: string, after: string): boolean {
  return !isSpace(before) && !DIGIT.test(after) && after !== '$'
}

export interface InlineMathSpan {
  /** The offset of the dollar that opens. */
  readonly open: number
  /** The offset of the dollar that closes. */
  readonly close: number
}

/**
 * The inline math in a run of prose, as the tokenizer would read it: from a
 * dollar that opens to the next unescaped dollar, which has to close. If it
 * cannot, the opener is not one and the scan goes on from the next character,
 * so that dollar may open a span of its own.
 *
 * A backslash takes the character after it, so `\$` is a dollar in prose
 * outside a formula and a dollar sign inside one.
 */
export function inlineMathSpans(source: string): readonly InlineMathSpan[] {
  const spans: InlineMathSpan[] = []
  // Where the last escaped character is: a dollar straight after an escaped dollar is the first
  // of a pair of its own, not the second of the escaped one's (`syntax.ts`'s `previous`).
  let escaped = -1
  for (let open = 0; open < source.length; open += 1) {
    const character = source.charAt(open)
    if (character === '\\') {
      escaped = open + 1
      open += 1
      continue
    }
    const before = escaped === open - 1 ? '' : source.charAt(open - 1)
    if (character !== '$' || !opensInlineMath(before, source.charAt(open + 1))) continue
    const close = nextDollar(source, open + 1)
    if (close === undefined) break
    if (closesInlineMath(source.charAt(close - 1), source.charAt(close + 1))) {
      spans.push({ open, close })
      open = close
    }
  }
  return spans
}

/** The offset of the next dollar that is not escaped, from `from`. */
function nextDollar(source: string, from: number): number | undefined {
  for (let index = from; index < source.length; index += 1) {
    const character = source.charAt(index)
    if (character === '\\') index += 1
    else if (character === '$') return index
  }
  return undefined
}
