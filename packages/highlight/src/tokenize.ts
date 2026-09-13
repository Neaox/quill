/**
 * The tokenizer: walks a Prism token tree into the flat, tiled `TokenRange[]`
 * both presentations render from (ADR-030). Prism answers "what does this
 * look like as one recursive tree of nested tokens"; this module flattens
 * that into "which UTF-16 span is which themed class", which is the shape
 * `toMarkup`, `packRanges`, and the CSS Custom Highlight registry all share.
 *
 * A nested token — markup inside a template string, say — contributes its
 * *leaves*, each labelled by its own innermost type and aliases: an inner
 * token's colour always beats an inherited outer one, since no rule here
 * matches on ancestry, only on the leaf's own classes.
 *
 * A leaf whose own classes are not themed at all falls back to the nearest
 * enclosing token that is. Grammars name the parts of a construct as freely as
 * the construct itself — a diff's `line` inside its `deleted-sign`, an
 * f-string's `format-spec` inside its `interpolation` — and without this rule a
 * deleted diff line would colour its leading `-` and leave the line it deletes
 * plain. Nothing is invented: the fallback is only ever a class some ancestor
 * already resolved to.
 */
import { Prism, type PrismTypes } from './grammars.ts'
import { type TokenRange, resolveTokenClass } from './tokens.ts'

function classesOf(token: PrismTypes.Token): string[] {
  // @types/prismjs declares `alias` as always present, but the Token
  // constructor leaves it `undefined` when the grammar rule gave none.
  const alias = token.alias as string | string[] | undefined
  if (alias == null) return [token.type]
  return [token.type, ...(Array.isArray(alias) ? alias : [alias])]
}

/**
 * Tokenizes `text` under `language`'s grammar into leaf spans.
 *
 * Ranges are sorted, non-overlapping, and tile the text: every character is
 * in exactly one range or in an untokenized gap, which renders as plain text
 * in both presentations. A language with no registered grammar (including
 * every fence tag that never went through `resolveLanguage`) yields no
 * ranges rather than throwing.
 */
export function tokenize(text: string, language: string): TokenRange[] {
  const grammar = Prism.languages[language]
  if (grammar === undefined) return []

  const ranges: TokenRange[] = []
  let offset = 0

  const walk = (
    parts: readonly (string | PrismTypes.Token)[],
    enclosing: TokenRange['type'] | null,
  ): void => {
    for (const part of parts) {
      if (typeof part === 'string') {
        if (enclosing !== null && part.length > 0) {
          ranges.push({ start: offset, end: offset + part.length, type: enclosing })
        }
        offset += part.length
        continue
      }

      const resolved = resolveTokenClass(classesOf(part)) ?? enclosing
      const content = part.content
      if (typeof content === 'string') {
        if (resolved !== null && content.length > 0) {
          ranges.push({ start: offset, end: offset + content.length, type: resolved })
        }
        offset += content.length
      } else {
        // @types/prismjs's TokenStream allows a bare Token here, but
        // matchGrammar (prism.js) only ever nests through its own
        // `tokenize()`, whose result is always an array — so Prism's actual
        // output never hits the single-Token case the ambient type admits.
        walk(content as readonly (string | PrismTypes.Token)[], resolved)
      }
    }
  }

  walk(Prism.tokenize(text, grammar), null)
  return ranges
}
