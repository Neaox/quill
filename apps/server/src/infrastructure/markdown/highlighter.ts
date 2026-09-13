import { highlight, resolveLanguage } from '@quill/highlight'
import type { SupportedLanguage } from '@quill/highlight'
import type { HighlightedCode, Highlighter } from '@quill/markdown'

/**
 * The server tokenizes; readers do not download grammars (ADR-030).
 *
 * The renderer takes this as an option rather than importing a tokenizer, so
 * `packages/markdown` stays free of grammars and this is the one place the two
 * are composed. A block in a language nothing is registered for, one large
 * enough that its packed ranges would outweigh the page, or one the tokenizer
 * cannot handle is left for the client to highlight on demand.
 */

/**
 * Above this many characters a block's packed ranges cost more to ship than
 * tokenizing it in the reader's own worker would (ADR-030's size threshold).
 */
export const MAX_EMBEDDED_HIGHLIGHT_CHARS = 8_192

export interface HighlighterOptions {
  readonly maxChars?: number
  /** The tokenizer, injected so the degraded path can be exercised. */
  readonly pack?: (text: string, language: SupportedLanguage) => string
}

const packRanges = (text: string, language: SupportedLanguage): string =>
  highlight(text, language).packed

export function createHighlighter(options: HighlighterOptions = {}): Highlighter {
  const maxChars = options.maxChars ?? MAX_EMBEDDED_HIGHLIGHT_CHARS
  const pack = options.pack ?? packRanges

  return (text: string, language: string): HighlightedCode | null => {
    if (text.length > maxChars) return null
    const resolved = resolveLanguage(language)
    if (resolved === null) return null
    try {
      // The resolved grammar travels with the ranges, so `data-lang` names
      // what the tokens were actually produced for rather than whatever the
      // author typed after the backticks (ADR-030).
      return { language: resolved, tokens: pack(text, resolved) }
    } catch {
      // Correct, uncoloured monospace text until hydration is a documented
      // outcome (ADR-030); a failed render is not.
      //
      // TODO(highlight): `@quill/highlight` reads `Prism.languages` from a
      // namespace import of the CommonJS `prismjs`, which is undefined under
      // plain Node ESM (it lives on `.default`), so tokenizing throws wherever
      // the server runs without a bundler. Remove this guard once that package
      // resolves the runtime through its interop default.
      return null
    }
  }
}
