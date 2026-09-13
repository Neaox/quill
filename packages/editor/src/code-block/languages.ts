import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import type { LanguageSupport } from '@codemirror/language'

/**
 * The languages a code block can be written in, and the fence names that mean
 * them.
 *
 * The list is the *reading surface's* list (ADR-030: `packages/highlight`
 * registers the grammars a published block is coloured by), so the name the
 * picker writes onto a block is a name the reader's tokenizer knows. A few of
 * those languages have a CodeMirror grammar as well and are coloured while they
 * are being written; the rest are written as plain monospace and coloured once
 * they are published, which is why `load` is optional rather than a reason to
 * leave the language out of the picker altogether.
 *
 * The fence name is still the document's: whatever the author typed after the
 * backticks is preserved on the node and written back unchanged, so a block
 * tagged with a language nothing here knows still round-trips. Nothing in this
 * list is loaded until a block asks for it, which is why a grammar is behind a
 * function.
 */

export interface EditorLanguage {
  /** The canonical fence name, and what the picker writes onto the node. */
  readonly id: string
  readonly label: string
  readonly aliases: readonly string[]
  /** Absent where the reading surface colours the language and CodeMirror cannot. */
  readonly load?: () => LanguageSupport
}

/**
 * Ordered by label, because that is the order the picker shows them in and a
 * list a reader has to scan is easier to scan alphabetically than by whichever
 * grammar happened to be registered first.
 */
export const LANGUAGES: readonly EditorLanguage[] = [
  { id: 'bash', label: 'Bash', aliases: ['sh', 'shell', 'zsh', 'console', 'shell-session'] },
  { id: 'csharp', label: 'C#', aliases: ['cs', 'dotnet'] },
  { id: 'css', label: 'CSS', aliases: [], load: () => css() },
  { id: 'diff', label: 'Diff', aliases: ['patch'] },
  { id: 'docker', label: 'Dockerfile', aliases: ['dockerfile'] },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  {
    id: 'html',
    label: 'HTML',
    aliases: ['htm', 'markup', 'xml', 'xhtml', 'svg'],
    load: () => html(),
  },
  { id: 'java', label: 'Java', aliases: [] },
  {
    id: 'javascript',
    label: 'JavaScript',
    aliases: ['js', 'mjs', 'cjs'],
    load: () => javascript(),
  },
  { id: 'jsx', label: 'JavaScript (JSX)', aliases: [], load: () => javascript({ jsx: true }) },
  { id: 'json', label: 'JSON', aliases: ['jsonc', 'json5'], load: () => json() },
  { id: 'markdown', label: 'Markdown', aliases: ['md'], load: () => markdown() },
  { id: 'python', label: 'Python', aliases: ['py'], load: () => python() },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'sql', label: 'SQL', aliases: ['postgresql', 'psql'], load: () => sql() },
  { id: 'toml', label: 'TOML', aliases: [] },
  {
    id: 'tsx',
    label: 'TypeScript (JSX)',
    aliases: [],
    load: () => javascript({ typescript: true, jsx: true }),
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    aliases: ['ts'],
    load: () => javascript({ typescript: true }),
  },
  { id: 'yaml', label: 'YAML', aliases: ['yml'], load: () => yaml() },
]

const BY_NAME: ReadonlyMap<string, EditorLanguage> = new Map(
  LANGUAGES.flatMap((language) =>
    [language.id, ...language.aliases].map((name) => [name, language] as const),
  ),
)

/** The entry for a fence name, or undefined for plain, unnamed text. */
export function resolveLanguage(name: string | null | undefined): EditorLanguage | undefined {
  return name === null || name === undefined ? undefined : BY_NAME.get(name.toLowerCase().trim())
}

/** The grammar for a fence name, where one runs in the editor. */
export function loadGrammar(language: EditorLanguage | undefined): LanguageSupport | undefined {
  return language?.load?.()
}
