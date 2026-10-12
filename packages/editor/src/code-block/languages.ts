/**
 * The languages a code block can be written in: the language registry of
 * `@quill/highlight` (ADR-030), which the reader, the renderer and the
 * editor all read, so the name the picker writes onto a block is a name the
 * tokenizer colours in both places. Nothing here restates it.
 *
 * The fence name is still the document's: whatever the author typed after the
 * backticks is preserved on the node and written back unchanged, so a block
 * tagged with a language nothing here knows still round-trips, as plain text.
 */
export {
  CODE_LANGUAGES as LANGUAGES,
  languageForFile,
  resolveCodeLanguage as resolveLanguage,
  type RegisteredLanguage as EditorLanguage,
} from '@quill/highlight/languages'
