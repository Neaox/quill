/**
 * Public API of the highlight package's core: DOM-free, safe to import on the
 * server or in a worker (ADR-030). Client-only presentation lives in the
 * package's `client` entry point.
 */
export { SUPPORTED_LANGUAGES, resolveLanguage, type SupportedLanguage } from './grammars.ts'
export {
  TOKEN_CLASSES,
  TOKEN_CLASS_ALIASES,
  TOKEN_CLASS_PREFIX,
  TOKEN_HIGHLIGHT_PREFIX,
  resolveTokenClass,
} from './tokens.ts'
export type { TokenClass, TokenRange } from './tokens.ts'
export { tokenize } from './tokenize.ts'
export { packRanges, unpackRanges } from './pack.ts'
export { toMarkup } from './markup.ts'
export {
  SYNC_TOKENIZE_MAX_CHARS,
  highlight,
  type HighlightResult,
  type TokenizeScheduler,
} from './highlight.ts'
export {
  REVIEWED_UNTHEMED_GROUPS,
  grammarTokenClasses,
  grammarTokenGroups,
  tokenCssContract,
  tokenGroupKey,
  unthemedTokenGroups,
  type TokenCssContract,
} from './css-contract.ts'
