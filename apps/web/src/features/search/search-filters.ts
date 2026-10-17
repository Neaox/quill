import { isFieldFilterKey, parseQuery, serializeQuery } from '@quill/search/query'
import type { FieldFilterKey } from '@quill/search/query'

/**
 * Reading and editing a search as the filters in it (ADR-010).
 *
 * The query language is the product's own and the server parses it; this reads
 * the same text with the same parser, so a chip, a suggestion and the answer on
 * screen can never disagree about what was asked. Nothing here is state: every
 * function takes the text and gives back text or a description of it, and the
 * box stays the one place the query lives.
 */

export interface FilterDescription {
  readonly key: FieldFilterKey
  /** What it is called to a person: the chip's name and the list's heading. */
  readonly label: string
  /** One line on what it finds, shown beside it where it is offered. */
  readonly hint: string
  /** Whether the server can suggest values for it (`GET /api/search/suggestions`). */
  readonly suggests: boolean
}

/**
 * Every filter, in the order they are offered: the ones people reach for first
 * (who, which team, what it is about, where it lives), then the rest.
 */
export const FILTERS: readonly FilterDescription[] = [
  { key: 'by', label: 'By', hint: 'Who published it: a name, an address, or me', suggests: true },
  { key: 'team', label: 'Team', hint: 'Anyone in a group or unit', suggests: true },
  { key: 'tag', label: 'Tag', hint: 'A tag the document carries', suggests: true },
  { key: 'collection', label: 'Collection', hint: 'Where it is filed', suggests: true },
  { key: 'in', label: 'Workspace', hint: 'Only look in one workspace', suggests: true },
  { key: 'status', label: 'Status', hint: 'Draft, published and the rest', suggests: true },
  { key: 'owner', label: 'Owner', hint: 'A named owner of the document', suggests: false },
  { key: 'prop', label: 'Property', hint: 'A custom property: key=value', suggests: false },
  { key: 'title', label: 'Title', hint: 'Words in the title only', suggests: false },
]

function describe(key: FieldFilterKey): FilterDescription {
  const found = FILTERS.find((filter) => filter.key === key)
  /* v8 ignore next -- a test asserts FILTERS names every key the language has. */
  return found ?? { key, label: key, hint: '', suggests: false }
}

export interface FilterChip {
  /** Which clause of the query this is, counting words and phrases too: what `withoutClause` takes. */
  readonly clause: number
  readonly key: FieldFilterKey
  /** What was filtered on, without quotes. */
  readonly value: string
  readonly negated: boolean
  /** The chip read as a sentence: "By: me", "Not tag: old". */
  readonly text: string
}

/** A filter as a short phrase: capital first for a filter asked for, "Not" in front of one left out. */
function chipText(key: FieldFilterKey, value: string, negated: boolean): string {
  const { label } = describe(key)
  return negated ? `Not ${label.toLowerCase()}: ${value}` : `${label}: ${value}`
}

/**
 * The filters in a query, as chips.
 *
 * Words, phrases and exclusions stay in the box; a filter is the part of a
 * search that is easier to see and remove than to read in a line of text. A
 * query the parser cannot read has no chips: the box says what is wrong with
 * it, and a chip made from half of it would claim to know what was meant.
 */
export function filterChips(text: string): readonly FilterChip[] {
  const parsed = parseQuery(text)
  if (!parsed.ok) return []
  return parsed.value.clauses.flatMap((clause, index) =>
    clause.kind === 'filter'
      ? [
          {
            clause: index,
            key: clause.key,
            value: clause.value,
            negated: clause.negated,
            text: chipText(clause.key, clause.value, clause.negated),
          },
        ]
      : [],
  )
}

/**
 * The query with one clause taken out. Text the parser cannot read, or a clause
 * that is not there, comes back exactly as it was: removing a chip must never
 * be the thing that changes what somebody typed.
 */
export function withoutClause(text: string, clause: number): string {
  const parsed = parseQuery(text)
  if (!parsed.ok || clause < 0 || clause >= parsed.value.clauses.length) return text
  return serializeQuery({ clauses: parsed.value.clauses.filter((_, index) => index !== clause) })
}

/**
 * The query with one more filter on the end. Words, phrases and exclusions
 * stay as they are and the value is quoted by the serializer when it needs it.
 * Text the parser cannot read comes back untouched, as it does for
 * `withoutClause`: a suggestion must never rewrite what somebody typed.
 */
export function withClause(text: string, key: FieldFilterKey, value: string): string {
  const parsed = parseQuery(text)
  if (!parsed.ok) return text
  return serializeQuery({
    clauses: [...parsed.value.clauses, { kind: 'filter', key, value, negated: false }],
  })
}

/** The part of the box the caret is in, and what it means. */
export interface QueryToken {
  readonly start: number
  readonly end: number
  /** Exactly the characters in `start..end`. */
  readonly raw: string
  /** Led by a minus: a filter left out. */
  readonly negated: boolean
  /** The filter being typed, or null for a word, a phrase, or the whitespace between them. */
  readonly key: FieldFilterKey | null
  /** What has been typed after the colon, unquoted; for a word, the word. */
  readonly value: string
}

const WHITESPACE = /\s/u

/** The index just past the whitespace-delimited token starting at `start`, quotes kept whole. */
function tokenEnd(text: string, start: number): number {
  let index = start
  let quoted = false
  while (index < text.length) {
    const character = text.charAt(index)
    if (quoted) {
      if (character === '\\') index += 1
      else if (character === '"') quoted = false
    } else if (character === '"') {
      quoted = true
    } else if (WHITESPACE.test(character)) {
      break
    }
    index += 1
  }
  return Math.min(index, text.length)
}

/** The characters of a value as typed so far: a leading quote dropped, escapes undone, a closing quote dropped. */
function unquote(raw: string): string {
  if (!raw.startsWith('"')) return raw
  let value = ''
  let index = 1
  while (index < raw.length) {
    const character = raw.charAt(index)
    if (character === '\\' && index + 1 < raw.length) {
      value += raw.charAt(index + 1)
      index += 2
    } else if (character === '"') {
      break
    } else {
      value += character
      index += 1
    }
  }
  return value
}

const KEY_PREFIX = /^([A-Za-z]+):/u

function describeToken(raw: string, start: number, end: number): QueryToken {
  const negated = raw.startsWith('-')
  const body = negated ? raw.slice(1) : raw
  const match = KEY_PREFIX.exec(body)
  const key = match?.[1]?.toLowerCase()
  if (match !== null && key !== undefined && isFieldFilterKey(key)) {
    return {
      start,
      end,
      raw,
      negated,
      key,
      value: unquote(body.slice(match[0].length)),
    }
  }
  return { start, end, raw, negated, key: null, value: unquote(body) }
}

/**
 * The token the caret is in: the key and the part of the value typed so far
 * when it is a filter, so the right suggestions can be asked for. In the
 * whitespace between tokens (or an empty box) it is an empty token at the
 * caret, which is where a new word would begin.
 */
export function tokenAt(text: string, caret: number): QueryToken {
  let index = 0
  while (index < text.length) {
    while (index < text.length && WHITESPACE.test(text.charAt(index))) index += 1
    if (index >= text.length) break
    const start = index
    const end = tokenEnd(text, start)
    if (caret >= start && caret <= end) return describeToken(text.slice(start, end), start, end)
    index = end
  }
  return { start: caret, end: caret, raw: '', negated: false, key: null, value: '' }
}

/**
 * The filters a half-typed word begins ("te" offers Team), so discovering a
 * filter does not mean knowing its name. Nothing for an empty word, which would
 * list every filter on every space, and nothing for a word that already is one.
 */
export function keySuggestions(word: string): readonly FilterDescription[] {
  const needle = word.toLowerCase()
  if (needle === '') return []
  return FILTERS.filter((filter) => filter.key.startsWith(needle) && filter.key !== needle)
}

export interface Edit {
  readonly text: string
  /** Where the caret goes, so typing carries on from the choice. */
  readonly caret: number
}

function filterText(key: FieldFilterKey, value: string): string {
  return serializeQuery({ clauses: [{ kind: 'filter', key, value, negated: false }] })
}

/**
 * The text with `token` replaced by a filter and its chosen value, or, with no
 * value, by just the filter's name and its colon (choosing "Team" from the list
 * of filters), after which the values for it are the next thing to be offered.
 *
 * A minus on the token stays: choosing a value must not turn leaving a person
 * out into asking for them. A space follows a chosen value unless one already
 * does, so the next word starts clean.
 */
export function acceptSuggestion(
  text: string,
  token: QueryToken,
  key: FieldFilterKey,
  value: string | null,
): Edit {
  const sign = token.negated ? '-' : ''
  const before = text.slice(0, token.start)
  const after = text.slice(token.end)
  if (value === null) {
    const replacement = `${sign}${key}:`
    return { text: `${before}${replacement}${after}`, caret: before.length + replacement.length }
  }
  const replacement = `${sign}${filterText(key, value)}`
  const needsSpace = after === '' || !WHITESPACE.test(after.charAt(0))
  const spaced = needsSpace ? `${replacement} ` : replacement
  return {
    text: `${before}${spaced}${after}`,
    caret: before.length + spaced.length,
  }
}
