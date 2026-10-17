/**
 * What a find is looking for, and what a match is replaced with, the way VS Code does it.
 *
 * A query is plain text or a regular expression, matched with or without regard to case, and as
 * whole words or not. A replacement is text as written, or, for a regular expression, a template
 * that takes the match apart (`$1`, `$&`, `$<name>`). Either may follow the case of what it replaces.
 * Nothing here knows about documents: it works on strings, so it is tested on strings.
 */

export interface FindOptions {
  readonly caseSensitive: boolean
  readonly wholeWord: boolean
  /** The query is a regular expression, in Unicode mode, and the replacement a template. */
  readonly regex: boolean
  /** The replacement takes the case of the text it replaces. */
  readonly preserveCase: boolean
}

export type Pattern =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'ok'; readonly regex: RegExp }

/** A pattern that can be searched with. */
export type CompiledPattern = Extract<Pattern, { readonly kind: 'ok' }>

const WORD_CHARACTER = String.raw`[\p{L}\p{N}_]`
const ISOLATED_BEFORE = `(?<!${WORD_CHARACTER})`
const ISOLATED_AFTER = `(?!${WORD_CHARACTER})`

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && new RegExp(`^${WORD_CHARACTER}$`, 'u').test(character)

const escaped = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)

/** The regular expression source for a query: its own for a pattern, escaped for plain text, bounded for whole words. */
function sourceOf(query: string, { regex, wholeWord }: FindOptions): string {
  if (regex) return wholeWord ? `${ISOLATED_BEFORE}(?:${query})${ISOLATED_AFTER}` : query
  const characters = Array.from(query)
  const before = wholeWord && isWordCharacter(characters.at(0)) ? ISOLATED_BEFORE : ''
  const after = wholeWord && isWordCharacter(characters.at(-1)) ? ISOLATED_AFTER : ''
  return `${before}${escaped(query)}${after}`
}

export function compilePattern(query: string, options: FindOptions): Pattern {
  if (query === '') return { kind: 'empty' }
  try {
    return {
      kind: 'ok',
      regex: new RegExp(sourceOf(query, options), options.caseSensitive ? 'gu' : 'giu'),
    }
  } catch (error) {
    // Only a SyntaxError is thrown here, and its text is the engine's own reason.
    return { kind: 'invalid', message: String(error).replace(/^SyntaxError: /u, '') }
  }
}

/** Each match of `regex` in `text` that is not empty: nothing to select, highlight or replace. */
export function* matchesIn(text: string, regex: RegExp): Generator<RegExpExecArray> {
  for (const match of text.matchAll(regex)) {
    if (match[0] !== '') yield match
  }
}

/** The text of the group `digits` names, reading two digits as one group only where there is such a group. */
function groupOf(match: RegExpMatchArray, digits: string): string {
  if (digits.length === 2 && Number(digits) >= match.length) {
    return (match[Number(digits.charAt(0))] ?? '') + digits.charAt(1)
  }
  return match[Number(digits)] ?? ''
}

const TOKEN = /\$(?:(\$)|(&)|(\d{1,2})|<([^>]*)>)/gu

/**
 * The replacement for one match: the text as written, or for a regular expression its template
 * filled in, and then in the case of what it replaces if that was asked for.
 */
export function replacementFor(
  match: RegExpMatchArray,
  template: string,
  { regex, preserveCase }: FindOptions,
): string {
  const text = regex
    ? template.replaceAll(
        TOKEN,
        (_token, dollar?: string, whole?: string, digits?: string, name = '') => {
          if (dollar !== undefined) return '$'
          if (whole !== undefined) return match[0]
          if (digits !== undefined) return groupOf(match, digits)
          return match.groups?.[name] ?? ''
        },
      )
    : template
  return preserveCase ? matchCase(match[0], text) : text
}

/**
 * `replacement` in the case of `replaced`: all capitals for capitals, all lower case for lower
 * case, a capital first for a capital first. Anything else, a mixture or no letters, is left alone.
 */
export function matchCase(replaced: string, replacement: string): string {
  const upper = replaced.toUpperCase()
  const lower = replaced.toLowerCase()
  if (replaced === upper && replaced !== lower) return replacement.toUpperCase()
  if (replaced === lower && replaced !== upper) return replacement.toLowerCase()
  if (/^\p{Lu}/u.test(replaced)) return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  return replacement
}
