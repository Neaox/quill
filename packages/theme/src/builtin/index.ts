/**
 * The built-in theme documents, and nothing else (`@quill/theme/builtin`).
 *
 * The package's main entry is the whole of ADR-028's machinery: the schema
 * validator (Ajv and its format plugins) and the theme doctor (culori,
 * apca-w3). Together those are about 82 KB gzipped, and they belong to the
 * theme editor and the build-time token generator — never to somebody reading
 * a document. A consumer that only needs the identities themselves imports
 * this entry instead, and the tools **cannot** follow: every module below this
 * one is a plain data declaration whose only imports are `import type`, so the
 * saving is a property of the module graph rather than of how well a bundler
 * happens to tree-shake (review 2026-09-13, H1).
 *
 * The types come from the schema module, but as `export type` only, which the
 * compiler erases: nothing here reaches the validator at runtime.
 */
export { atelier } from './atelier.ts'
export { instrument } from './instrument.ts'
export { press } from './press.ts'
export { BUILTIN_THEMES, DEFAULT_THEME, builtinTheme } from './themes.ts'
export type {
  BuiltinThemeId,
  ThemeDocument,
  ThemeShape,
  ThemeVariants,
} from '../schema/theme-document.ts'
