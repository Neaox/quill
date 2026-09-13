/**
 * The token class model: the fixed, ordered set of themed classes a range
 * can resolve to, and the precedence rule that picks one class for a token
 * carrying several (Prism's `type` plus its `alias` list).
 *
 * This list is the single source of truth for `tokenize`, `toMarkup`, the
 * CSS Custom Highlight registry, and the CSS contract the theme is checked
 * against (ADR-030) — order is contractual, not cosmetic: a multi-class
 * token resolves to whichever listed class has the highest index, the same
 * rule a stylesheet declaring `.tok-<class>` rules in this order encodes via
 * the cascade, so both presentations colour a token identically.
 */
import { BRAND } from '@quill/brand'

/** Every themed token class, lowest to highest precedence. */
export const TOKEN_CLASSES = [
  'punctuation',
  'comment',
  'keyword',
  'operator',
  'boolean',
  'null',
  'number',
  'string',
  'template-string',
  'interpolation',
  'function',
  'class-name',
  'property',
  'attr-name',
  'attr-value',
  'tag',
  'selector',
  'regex',
  'important',
  'variable',
  'constant',
  'symbol',
  'builtin',
  'deleted',
  'inserted',
  'url',
  'title',
  'bold',
  'italic',
] as const

export type TokenClass = (typeof TOKEN_CLASSES)[number]

/** Prefix for the markup backend's per-token class name (`tok-string`, …). */
export const TOKEN_CLASS_PREFIX = 'tok-'

/** Prefix for the ranges backend's per-class `CSS.highlights` entry name. */
export const TOKEN_HIGHLIGHT_PREFIX = `${BRAND.slug}-tok-`

/** One token's span in the source text, `[start, end)`, in UTF-16 units. */
export interface TokenRange {
  readonly start: number
  readonly end: number
  readonly type: TokenClass
}

/**
 * Raw Prism class names that carry no themed class of their own but mean the
 * same thing as one that does, so a token wearing only the raw name still gets
 * a colour.
 *
 * Three of these come straight from Prism's own default theme, which groups
 * `prolog`/`doctype`/`cdata` with comments, `char` with strings, `entity` with
 * operators and `atrule` with keywords: following it means a block Quill renders
 * colours the constructs Prism would. The rest name a construct this list had no
 * entry for at all, and each is mapped to the nearest thing it is: a JSX spread
 * is an operator, a parameter is a binding, a Dockerfile instruction is a
 * keyword, SQL's backtick-quoted name is a property, C#'s `$"{…}"` hole is an
 * interpolation, Markdown's `~~struck~~` is removed text, and a diff's `---`,
 * `+++` and `@@` headers are metadata about the patch rather than the patch.
 */
export const TOKEN_CLASS_ALIASES: Readonly<Record<string, TokenClass>> = {
  prolog: 'comment',
  doctype: 'comment',
  cdata: 'comment',
  char: 'string',
  entity: 'operator',
  atrule: 'keyword',
  spread: 'operator',
  parameter: 'variable',
  instruction: 'keyword',
  identifier: 'property',
  'format-string': 'interpolation',
  strike: 'deleted',
  coord: 'comment',
}

const PRECEDENCE: Readonly<Record<TokenClass, number>> = buildPrecedence()

function buildPrecedence(): Readonly<Record<TokenClass, number>> {
  // Every TOKEN_CLASSES entry gets an index below; the cast reflects that
  // completeness, which TypeScript cannot infer from a loop over a const tuple.
  const precedence = {} as Record<TokenClass, number>
  TOKEN_CLASSES.forEach((tokenClass, index) => {
    precedence[tokenClass] = index
  })
  return precedence
}

const resolutionMemo = new Map<string, TokenClass | null>()

/**
 * Picks the one themed class a token's Prism classes (its `type`, then its
 * `alias` or aliases) resolve to, or null when none of them are themed.
 *
 * A class that is not itself a `TOKEN_CLASSES` entry is looked up in
 * `TOKEN_CLASS_ALIASES` first, and then competes on the precedence of whatever
 * it maps to, so an alias never beats a class that is listed later.
 *
 * Memoised on the joined class list: Prism emits a handful of distinct
 * combinations per grammar, so the memo stays small while sparing every
 * token a re-scan of `TOKEN_CLASSES`.
 */
export function resolveTokenClass(classes: readonly string[]): TokenClass | null {
  const key = classes.join(' ')
  const memoised = resolutionMemo.get(key)
  if (memoised !== undefined) return memoised

  let winner: TokenClass | null = null
  let winnerPrecedence = -1
  for (const candidate of classes) {
    const themed = isTokenClass(candidate) ? candidate : TOKEN_CLASS_ALIASES[candidate]
    if (themed === undefined) continue
    const precedence = PRECEDENCE[themed]
    if (precedence > winnerPrecedence) {
      winnerPrecedence = precedence
      winner = themed
    }
  }
  resolutionMemo.set(key, winner)
  return winner
}

function isTokenClass(value: string): value is TokenClass {
  return Object.hasOwn(PRECEDENCE, value)
}
