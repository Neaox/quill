import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'

import { findMatches } from '../find/find-matches.ts'
import type { Match } from '../find/find-matches.ts'
import { compilePattern } from '../find/find-pattern.ts'

/**
 * Select next occurrence (Ctrl+D): the word under the caret, and then, press by press, each next
 * place the selected words come, through the document and round to the start again.
 *
 * It is one selection that moves on, not several at once: a document here has a single caret. A
 * word is found as a whole word, so `ship` is not found in `shipping`; anything that is not a word
 * (words with a space between, a symbol) is found as it is written.
 */

const WORD_CHARACTER = '[\\p{L}\\p{N}_]'
const WORDS = new RegExp(`${WORD_CHARACTER}+`, 'gu')

/** The word the caret is in or has just reached the end of, in the line of text it is in. */
function wordAround($pos: ResolvedPos): Match | undefined {
  const { parent, parentOffset } = $pos
  let around: Match | undefined
  parent.forEach((child, offset) => {
    if (around !== undefined || !child.isText) return
    for (const match of child.textContent.matchAll(WORDS)) {
      const start = offset + match.index
      if (start <= parentOffset && parentOffset <= start + match[0].length) {
        around = { from: $pos.start() + start, to: $pos.start() + start + match[0].length }
        return
      }
    }
  })
  return around
}

/** Where `needle` is found: as written, whole words where it begins and ends with a word character. */
const AS_WRITTEN = { caseSensitive: true, wholeWord: true, regex: false, preserveCase: false }

/** The first place `needle` is found that starts at or after `after`, or else the first in the document. */
function occurrenceAfter(doc: PMNode, needle: string, after: number): Match | undefined {
  const pattern = compilePattern(needle, AS_WRITTEN)
  // Plain text always compiles, and what is searched for is a selection, which is not empty.
  /* v8 ignore next */
  if (pattern.kind !== 'ok') return undefined
  const { matches } = findMatches(doc, pattern)
  return matches.find((match) => match.from >= after) ?? matches[0]
}

export const selectNextOccurrence: Command = (state, dispatch) => {
  const { selection, doc } = state
  if (!(selection instanceof TextSelection)) return false
  const { $from, $to } = selection
  // The first press takes the word; after it, the selection is what is searched for.
  const target = selection.empty
    ? wordAround($from)
    : $from.sameParent($to)
      ? { from: selection.from, to: selection.to }
      : undefined
  if (target === undefined) return false
  const found = selection.empty
    ? target
    : occurrenceAfter(doc, doc.textBetween(target.from, target.to), target.to)
  if (found !== undefined && dispatch !== undefined) {
    dispatch(
      state.tr.setSelection(TextSelection.create(doc, found.from, found.to)).scrollIntoView(),
    )
  }
  return true
}
