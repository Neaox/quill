/**
 * Public API of the highlight package's client entry point: the DOM-facing ranges/markup
 * presentation (ADR-030). Every capability that touches `window` or the
 * document arrives through an injected environment — see `apply-highlighting.ts`
 * — so this module ships no default browser wiring of its own.
 */
export {
  supportsHighlightRanges,
  type HighlightCapabilityEnvironment,
} from './supports-highlight-ranges.ts'
export {
  createTokenHighlightRegistry,
  tokenHighlightName,
  type HighlightRegistryLike,
  type HighlightSetLike,
  type TokenHighlightEnvironment,
  type TokenHighlightRegistry,
} from './highlight-registry.ts'
export {
  applyHighlighting,
  type CodeBlockElement,
  type HighlightClientEnvironment,
  type HighlightRoot,
  type TextNodeLike,
} from './apply-highlighting.ts'
