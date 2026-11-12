import { factorySpace } from 'micromark-factory-space'
import { markdownLineEnding, markdownSpace } from 'micromark-util-character'
import { codes, constants, types } from 'micromark-util-symbol'
import type {
  Code,
  Construct,
  Effects,
  Extension,
  State,
  TokenizeContext,
} from 'micromark-util-types'

import { closesInlineMath, opensInlineMath } from './rules.ts'

/**
 * The micromark syntax for math (ADR-064): `$…$` in a sentence, and a block
 * between two `$$` lines, or on one line as `$$ … $$`.
 *
 * It is a construct of the tokenizer, not a pass over the tree, because TeX is
 * not Markdown and must not be read as it: `a*b*c` is not emphasis, `\{` is not
 * an escape, a `|` in a table cell is not (yet) a column. By the time a tree
 * pass saw the text, CommonMark would already have changed it.
 *
 * Where a dollar is math and where it is a dollar is `rules.ts`'s decision.
 * Everything here that is not that decision is the shape of micromark's own
 * fenced code (`code-fenced.js`), which a fenced block of math is.
 */

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    mathText: 'mathText'
    mathTextSequence: 'mathTextSequence'
    mathTextData: 'mathTextData'
    mathFlow: 'mathFlow'
    mathFlowFence: 'mathFlowFence'
    mathFlowFenceSequence: 'mathFlowFenceSequence'
    mathFlowValue: 'mathFlowValue'
  }
}

const isDollar = (code: Code): boolean => code === codes.dollarSign
const isDigit = (code: Code): boolean =>
  code !== null && code >= codes.digit0 && code <= codes.digit9
const endsLine = (code: Code): boolean => code === codes.eof || markdownLineEnding(code)

/** The character a code stands for, for `rules.ts`, which reads characters. */
/* v8 ignore next -- micromark calls this with a character of the document, never with nothing. */
const characterOf = (code: Code): string =>
  code === null || code < 0 ? '' : String.fromCodePoint(code)

/**
 * Inline math: a dollar that opens, the formula, and a dollar that closes
 * (`rules.ts`). Like a code span it may run over a line ending.
 */
const mathText: Construct = {
  name: 'mathText',
  tokenize: tokenizeMathText,
  // A dollar straight after another is the second of a pair, which opens nothing,
  // unless the first was an escape: `\$$x$` is a dollar sign and then a formula.
  previous(this: TokenizeContext, code: Code): boolean {
    return (
      !isDollar(code) || this.events[this.events.length - 1]?.[1].type === types.characterEscape
    )
  },
}

function tokenizeMathText(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  let last: Code = codes.eof

  return start

  /** At the dollar that opens: `$x$`, `^`. */
  function start(code: Code): State | undefined {
    effects.enter('mathText')
    effects.enter('mathTextSequence')
    effects.consume(code)
    effects.exit('mathTextSequence')
    return afterOpening
  }

  /** After the opening dollar, before the first character of the formula. */
  function afterOpening(code: Code): State | undefined {
    if (endsLine(code) || !opensInlineMath('', characterOf(code))) return nok(code)
    effects.enter('mathTextData')
    return data(code)
  }

  /** In the formula. */
  function data(code: Code): State | undefined {
    if (code === codes.eof) return nok(code)
    if (markdownLineEnding(code)) {
      effects.exit('mathTextData')
      effects.enter(types.lineEnding)
      effects.consume(code)
      effects.exit(types.lineEnding)
      last = code
      return afterLineEnding
    }
    if (isDollar(code)) return closing(code)
    last = code
    effects.consume(code)
    // A backslash takes the character after it, a dollar included.
    return code === codes.backslash ? escaped : data
  }

  function afterLineEnding(code: Code): State | undefined {
    /* v8 ignore next -- a line ending was just consumed, so the document continues. */
    if (code === codes.eof) return nok(code)
    effects.enter('mathTextData')
    return data(code)
  }

  /** After a backslash in the formula: whatever follows is part of it. */
  function escaped(code: Code): State | undefined {
    if (endsLine(code)) return data(code)
    last = code
    effects.consume(code)
    return data
  }

  /** At a dollar in the formula: the end of it, if it may be. */
  function closing(code: Code): State | undefined {
    if (!closesInlineMath(characterOf(last), '')) return nok(code)
    effects.exit('mathTextData')
    effects.enter('mathTextSequence')
    effects.consume(code)
    return afterClosing
  }

  /** After the closing dollar: a digit, or a dollar, here means it was not one. */
  function afterClosing(code: Code): State | undefined {
    if (isDigit(code) || isDollar(code)) return nok(code)
    effects.exit('mathTextSequence')
    effects.exit('mathText')
    return ok(code)
  }
}

/**
 * A block: `$$` alone on a line, the formula, and `$$` alone on a line; or
 * `$$ formula $$` on a line by itself. A fence that is never closed is not a
 * block: a prose line that happens to begin `$$` must not swallow the rest of
 * the document the way an unclosed code fence does.
 */
const mathFlow: Construct = {
  name: 'mathFlow',
  tokenize: tokenizeMathFlow,
  concrete: true,
}

const closingFence: Construct = { partial: true, tokenize: tokenizeClosingFence }
const oneLineEnd: Construct = { partial: true, tokenize: tokenizeOneLineEnd }
const nonLazyContinuation: Construct = { partial: true, tokenize: tokenizeNonLazyContinuation }

function tokenizeMathFlow(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const { events } = this
  const interrupt = this.interrupt
  let initialPrefix = 0
  let hasFormula = false

  return start

  /** At the first dollar of the opening fence. */
  function start(code: Code): State | undefined {
    const tail = events[events.length - 1]
    initialPrefix =
      tail?.[1].type === types.linePrefix ? tail[2].sliceSerialize(tail[1], true).length : 0
    effects.enter('mathFlow')
    effects.enter('mathFlowFence')
    effects.enter('mathFlowFenceSequence')
    effects.consume(code)
    return secondDollar
  }

  function secondDollar(code: Code): State | undefined {
    if (!isDollar(code)) return nok(code)
    effects.consume(code)
    return afterSequence
  }

  /** A third dollar makes it neither a fence nor a block. */
  function afterSequence(code: Code): State | undefined {
    if (isDollar(code)) return nok(code)
    effects.exit('mathFlowFenceSequence')
    return markdownSpace(code)
      ? factorySpace(effects, afterFence, types.whitespace)(code)
      : afterFence(code)
  }

  /** After the fence and the space after it: a line of its own, or a formula. */
  function afterFence(code: Code): State | undefined {
    if (endsLine(code)) {
      effects.exit('mathFlowFence')
      return effects.check(nonLazyContinuation, atBreak, nok)(code)
    }
    // `$$ x $$` is a whole block in one line, and so cannot begin one in the middle of a paragraph.
    if (interrupt) return nok(code)
    effects.exit('mathFlowFence')
    effects.enter('mathFlowValue')
    return oneLineFormula(code)
  }

  /** In the formula of the one-line form. */
  function oneLineFormula(code: Code): State | undefined {
    if (endsLine(code)) return nok(code)
    if (isDollar(code)) return effects.check(oneLineEnd, endsOneLine, dollarInFormula)(code)
    hasFormula = hasFormula || !markdownSpace(code)
    effects.consume(code)
    return oneLineFormula
  }

  /** A dollar that is not the one-line form's closing `$$`: part of the formula. */
  function dollarInFormula(code: Code): State | undefined {
    hasFormula = true
    effects.consume(code)
    return oneLineFormula
  }

  /** At the `$$` that ends the one-line form. */
  function endsOneLine(code: Code): State | undefined {
    if (!hasFormula) return nok(code)
    effects.exit('mathFlowValue')
    effects.enter('mathFlowFence')
    effects.enter('mathFlowFenceSequence')
    effects.consume(code)
    return secondClosingDollar
  }

  function secondClosingDollar(code: Code): State | undefined {
    effects.consume(code)
    return afterClosingSequence
  }

  function afterClosingSequence(code: Code): State | undefined {
    effects.exit('mathFlowFenceSequence')
    return markdownSpace(code)
      ? factorySpace(effects, endOfBlock, types.whitespace)(code)
      : endOfBlock(code)
  }

  function endOfBlock(code: Code): State | undefined {
    effects.exit('mathFlowFence')
    effects.exit('mathFlow')
    return ok(code)
  }

  /** At the line ending after a line of a fenced block: a closing fence, or more formula. */
  function atBreak(code: Code): State | undefined {
    return effects.attempt(closingFence, closed, contentBefore)(code)
  }

  function contentBefore(code: Code): State | undefined {
    effects.enter(types.lineEnding)
    effects.consume(code)
    effects.exit(types.lineEnding)
    return contentStart
  }

  function contentStart(code: Code): State | undefined {
    return initialPrefix > 0 && markdownSpace(code)
      ? factorySpace(effects, beforeContent, types.linePrefix, initialPrefix + 1)(code)
      : beforeContent(code)
  }

  function beforeContent(code: Code): State | undefined {
    if (endsLine(code)) return effects.check(nonLazyContinuation, atBreak, nok)(code)
    effects.enter('mathFlowValue')
    return content(code)
  }

  function content(code: Code): State | undefined {
    if (endsLine(code)) {
      effects.exit('mathFlowValue')
      return beforeContent(code)
    }
    effects.consume(code)
    return content
  }

  function closed(code: Code): State | undefined {
    effects.exit('mathFlow')
    return ok(code)
  }
}

/** The line ending, and then the closing fence `$$` with nothing else on its line. */
function tokenizeClosingFence(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  return lineEnding

  function lineEnding(code: Code): State | undefined {
    effects.enter(types.lineEnding)
    effects.consume(code)
    effects.exit(types.lineEnding)
    return beforeFence
  }

  function beforeFence(code: Code): State | undefined {
    effects.enter('mathFlowFence')
    return markdownSpace(code)
      ? factorySpace(effects, firstDollar, types.linePrefix, constants.tabSize)(code)
      : firstDollar(code)
  }

  function firstDollar(code: Code): State | undefined {
    if (!isDollar(code)) return nok(code)
    effects.enter('mathFlowFenceSequence')
    effects.consume(code)
    return secondDollar
  }

  function secondDollar(code: Code): State | undefined {
    if (!isDollar(code)) return nok(code)
    effects.consume(code)
    return afterSequence
  }

  function afterSequence(code: Code): State | undefined {
    if (isDollar(code)) return nok(code)
    effects.exit('mathFlowFenceSequence')
    return markdownSpace(code)
      ? factorySpace(effects, endOfFence, types.whitespace)(code)
      : endOfFence(code)
  }

  function endOfFence(code: Code): State | undefined {
    if (!endsLine(code)) return nok(code)
    effects.exit('mathFlowFence')
    return ok(code)
  }
}

/** `$$`, then spaces, then the end of the line: where the one-line form ends. */
function tokenizeOneLineEnd(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  return firstDollar

  function firstDollar(code: Code): State | undefined {
    effects.consume(code)
    return secondDollar
  }

  function secondDollar(code: Code): State | undefined {
    if (!isDollar(code)) return nok(code)
    effects.consume(code)
    return afterDollars
  }

  function afterDollars(code: Code): State | undefined {
    if (isDollar(code)) return nok(code)
    return markdownSpace(code) ? factorySpace(effects, atEnd, types.whitespace)(code) : atEnd(code)
  }

  function atEnd(code: Code): State | undefined {
    return endsLine(code) ? ok(code) : nok(code)
  }
}

function tokenizeNonLazyContinuation(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const { lazy } = this.parser
  const currentLine = (): number => this.now().line
  return start

  function start(code: Code): State | undefined {
    if (code === codes.eof) return nok(code)
    effects.enter(types.lineEnding)
    effects.consume(code)
    effects.exit(types.lineEnding)
    return lineStart
  }

  function lineStart(code: Code): State | undefined {
    return lazy[currentLine()] ? nok(code) : ok(code)
  }
}

/** The syntax extension to register with micromark. */
export const mathSyntax: Extension = {
  flow: { [codes.dollarSign]: mathFlow },
  text: { [codes.dollarSign]: mathText },
}
