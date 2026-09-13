import type { Result } from '@quill/domain'
import { err, ok } from '@quill/domain'

import { isFieldFilterKey, type QueryClause, type SearchQuery } from './query.ts'

/**
 * Where and why {@link parseQuery} refused the input, so a caller can point at
 * the offending character rather than just saying "invalid query".
 */
export type QueryParseError =
  | {
      readonly kind: 'unterminated-quote'
      readonly position: number
      readonly message: string
    }
  | {
      readonly kind: 'empty-filter-value'
      readonly position: number
      readonly message: string
    }

const WHITESPACE = /\s/
const ASCII_LETTER = /[A-Za-z]/

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && WHITESPACE.test(character)
}

function isAsciiLetter(character: string | undefined): boolean {
  return character !== undefined && ASCII_LETTER.test(character)
}

/**
 * Parses free text into a {@link SearchQuery} (ADR-010, quill-plan.md §15).
 *
 * The grammar is deliberately small: whitespace separates clauses, a leading
 * `-` negates the clause that follows it, `"..."` marks an exact phrase (with
 * `\"` and `\\` as its only escapes, so a phrase can hold a literal quote),
 * and `key:value` is a field filter when `key` is one of
 * {@link FIELD_FILTER_KEYS} — anything else with a colon is read as a plain
 * term, so a query is never rejected for using a colon the language does not
 * reserve. `key:"quoted value"` lets a filter's value contain spaces.
 *
 * Two situations are refused outright, both reported with the character
 * position of the problem for a caller that wants to underline it in the
 * search box: a quote that never closes, and a filter whose colon is
 * followed by nothing (`title:` with no value, quoted or not).
 */
export function parseQuery(input: string): Result<SearchQuery, QueryParseError> {
  const clauses: QueryClause[] = []
  const length = input.length
  let index = 0

  while (index < length) {
    while (index < length && isWhitespace(input[index])) index += 1
    if (index >= length) break

    const clauseStart = index
    let negated = false
    if (input[index] === '-') {
      negated = true
      index += 1
    }

    const keyStart = index
    while (index < length && isAsciiLetter(input[index])) index += 1
    const candidateKey = input.slice(keyStart, index).toLowerCase()

    if (index < length && input[index] === ':' && isFieldFilterKey(candidateKey)) {
      const colonPosition = index
      index += 1
      const value = readValue(input, index)
      if (!value.ok) return value
      if (value.value.text.length === 0) {
        return err({
          kind: 'empty-filter-value',
          position: colonPosition,
          message: `"${candidateKey}:" needs a value`,
        })
      }
      clauses.push({ kind: 'filter', key: candidateKey, value: value.value.text, negated })
      index = value.value.next
      continue
    }

    if (input[index] === '"') {
      const value = readValue(input, index)
      if (!value.ok) return value
      clauses.push({ kind: 'phrase', value: value.value.text, negated })
      index = value.value.next
      continue
    }

    while (index < length && !isWhitespace(input[index])) index += 1
    const termValue = input.slice(negated ? clauseStart + 1 : clauseStart, index)
    if (termValue.length > 0) clauses.push({ kind: 'term', value: termValue, negated })
  }

  return ok({ clauses })
}

interface ReadValue {
  /** The value text, unescaped and unquoted. */
  readonly text: string
  /** The index just past the value, ready for the next scan. */
  readonly next: number
}

/**
 * Reads one filter or phrase value starting at `start`: a quoted, escaped
 * span when the next character is `"`, otherwise the run of non-whitespace
 * characters. Shared so a filter's value and a bare phrase parse identically.
 */
function readValue(input: string, start: number): Result<ReadValue, QueryParseError> {
  if (input[start] !== '"') {
    let index = start
    while (index < input.length && !isWhitespace(input[index])) index += 1
    return ok({ text: input.slice(start, index), next: index })
  }

  const quoteStart = start
  let index = start + 1
  let text = ''
  while (index < input.length && input[index] !== '"') {
    const character = input[index]
    if (character === '\\' && (input[index + 1] === '"' || input[index + 1] === '\\')) {
      text += input[index + 1]
      index += 2
    } else {
      text += character
      index += 1
    }
  }

  if (index >= input.length) {
    return err({
      kind: 'unterminated-quote',
      position: quoteStart,
      message: 'this quote is never closed',
    })
  }

  return ok({ text, next: index + 1 })
}
