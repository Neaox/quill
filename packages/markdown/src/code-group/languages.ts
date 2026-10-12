/**
 * The languages a fenced code block is named in, and what a reader calls them:
 * the language registry of `@quill/highlight` (ADR-030), re-exported so the
 * renderer and the reading bundle keep one import path. The registry is pure
 * data — it names grammars without importing them — so this package still
 * renders without the tokenizer.
 */
export {
  CODE_LANGUAGES,
  LANGUAGE_CATEGORIES,
  languageForFile,
  languageLabel,
  resolveCodeLanguage,
  type CodeLanguage,
  type LanguageCategory,
} from '@quill/highlight/languages'
