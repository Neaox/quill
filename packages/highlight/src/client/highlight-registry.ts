/**
 * The DOM side of the ranges presentation (ADR-030): one page-global
 * `Highlight` per themed token class, registered under
 * `<brand slug>-tok-<class>` so `::highlight(<brand slug>-tok-<class>)` in the theme's
 * stylesheet can paint it. A block contributes its ranges once, after
 * hydration, and gets back a disposer that removes exactly what it added —
 * nothing here mutates the DOM, a `Highlight` is a set of pointers.
 *
 * Range and `Highlight` construction stay outside this module: it only ever
 * sees the opaque range objects `applyHighlighting` builds, which is what
 * keeps this file testable without a DOM (a test's `createRange` can return
 * any plain marker value).
 */
import {
  TOKEN_CLASSES,
  TOKEN_HIGHLIGHT_PREFIX,
  type TokenClass,
  type TokenRange,
} from '../tokens.ts'

export interface HighlightSetLike {
  add(range: unknown): void
  delete(range: unknown): void
}

/** The read/write slice of `CSS.highlights` this module needs. */
export interface HighlightRegistryLike {
  get(name: string): HighlightSetLike | undefined
  set(name: string, value: HighlightSetLike): void
}

export interface TokenHighlightEnvironment {
  readonly highlights: HighlightRegistryLike
  createHighlightSet(): HighlightSetLike
}

export interface TokenHighlightRegistry {
  /**
   * Builds one range per entry in `ranges` (via `createRange`), adds each to
   * its class's `Highlight`, and returns a disposer that removes exactly
   * this call's ranges and nothing else.
   */
  applyRanges(
    createRange: (range: TokenRange) => unknown,
    ranges: readonly TokenRange[],
  ): () => void
}

/** The `CSS.highlights` entry name for one token class. */
export function tokenHighlightName(tokenClass: TokenClass): string {
  return `${TOKEN_HIGHLIGHT_PREFIX}${tokenClass}`
}

/**
 * Ensures one `Highlight` per token class exists in `env.highlights` —
 * reusing whatever is already registered under that name, so calling this
 * more than once (across `applyHighlighting` passes) never drops a class's
 * already-painted ranges — and returns the registry that applies blocks
 * against them.
 */
export function createTokenHighlightRegistry(
  env: TokenHighlightEnvironment,
): TokenHighlightRegistry {
  const sets = buildTokenHighlightSets(env)

  return {
    applyRanges(createRange, ranges) {
      const applied: Array<{ tokenClass: TokenClass; range: unknown }> = []
      for (const tokenRange of ranges) {
        const range = createRange(tokenRange)
        sets[tokenRange.type].add(range)
        applied.push({ tokenClass: tokenRange.type, range })
      }
      return () => {
        for (const { tokenClass, range } of applied) {
          sets[tokenClass].delete(range)
        }
      }
    },
  }
}

function buildTokenHighlightSets(
  env: TokenHighlightEnvironment,
): Readonly<Record<TokenClass, HighlightSetLike>> {
  // Every TOKEN_CLASSES entry is assigned below; the cast reflects that
  // completeness, which TypeScript cannot infer from a loop.
  const sets = {} as Record<TokenClass, HighlightSetLike>
  for (const tokenClass of TOKEN_CLASSES) {
    const name = tokenHighlightName(tokenClass)
    const existing = env.highlights.get(name)
    const set = existing ?? env.createHighlightSet()
    if (existing === undefined) env.highlights.set(name, set)
    sets[tokenClass] = set
  }
  return sets
}
