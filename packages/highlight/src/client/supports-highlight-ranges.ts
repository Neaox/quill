/**
 * The ranges-vs-markup detection matrix (ADR-030): Chrome 105+, Safari
 * 17.2+, and Firefox 140+ get token colour painted through `CSS.highlights`
 * over a single text node; everything else falls back to markup spans.
 *
 * The environment is injected rather than read off the real `window` so this
 * is testable without a DOM: a test passes a plain object shaped like the
 * pieces this function actually reads.
 */
export interface HighlightCapabilityEnvironment {
  readonly CSS?: { readonly highlights?: unknown }
  readonly Highlight?: unknown
}

export function supportsHighlightRanges(env: HighlightCapabilityEnvironment): boolean {
  return env.CSS?.highlights != null && env.Highlight != null
}
