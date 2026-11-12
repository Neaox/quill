import type { ParsedDocument } from '@quill/markdown'

/**
 * Values kept by a document's exact text until something takes them, for
 * the parse-once of a sync on the document work pool (ADR-062, step 3). A
 * sync inspects every changed document and then renders the same text, so:
 *
 * - each thread keeps the tree it parsed to inspect a text, and the render
 *   of that text takes it instead of parsing again (`ParsedTrees`);
 * - the pool keeps which thread inspected a text, so it can send the render
 *   there.
 *
 * - **Taken once.** Taking a value removes it: rendering resolves the links
 *   in a tree, and no later call sees that tree again.
 * - **Bounded.** At most `maxChars` characters of text are kept, the oldest
 *   dropped first, and a text longer than the bound is not kept. A tree is
 *   about thirteen times its text in memory, so the default of ten million
 *   characters is about 130 MB of a thread's heap. L is 18.4 MB across two
 *   threads, about 9.2 MB each: eight million dropped the largest trees
 *   before their renders, so ten million keeps a sync's whole corpus.
 * - **Never wrong.** A value is found by its exact text. A text that is not
 *   here is parsed, or rendered on any thread, so a miss costs a parse.
 */
export interface KeptByText<T> {
  keep(text: string, value: T): void
  take(text: string): T | undefined
  clear(): void
}

export type ParsedTrees = KeptByText<ParsedDocument>

export const KEPT_TEXT_MAX_CHARS = 10_000_000

export function createKeptByText<T>(maxChars = KEPT_TEXT_MAX_CHARS): KeptByText<T> {
  const kept = new Map<string, T>()
  let chars = 0
  return {
    keep(text, value) {
      if (text.length > maxChars) return
      // Deleted first, so a text kept again is the newest.
      if (kept.delete(text)) chars -= text.length
      kept.set(text, value)
      chars += text.length
      for (const oldest of kept.keys()) {
        if (chars <= maxChars) break
        kept.delete(oldest)
        chars -= oldest.length
      }
    },
    take(text) {
      const value = kept.get(text)
      if (value === undefined) return undefined
      kept.delete(text)
      chars -= text.length
      return value
    },
    clear() {
      kept.clear()
      chars = 0
    },
  }
}

export function createParsedTrees(maxChars = KEPT_TEXT_MAX_CHARS): ParsedTrees {
  return createKeptByText<ParsedDocument>(maxChars)
}
