/**
 * The language registry: every language a fenced code block can be written in,
 * once, for every surface (ADR-030).
 *
 * Each entry says what a reader calls the language, which fence names and file
 * extensions mean it, where the editor's picker files it, and which grammar
 * tokenizes it. The reader's tokenizer, the server's renderer, the copy
 * button, a code group's tab and the editor's picker and highlighter all read
 * this list and restate none of it, so a name the picker writes is a name the
 * tokenizer colours, and a language coloured in the reader is coloured in the
 * editor too.
 *
 * Pure data with no grammar attached — the grammar is named, not imported — so
 * the Markdown renderer and the reading bundle can name a language without
 * downloading Prism (`@quill/highlight/languages`). `languages.test.ts` holds
 * that every grammar named here is registered by `grammars.ts`, and that
 * `grammars.ts` registers nothing this list does not use.
 *
 * A fence nothing here knows is still the document's: it is written back as
 * typed and read as plain monospace text (AGENTS.md rule 7).
 */

/** How the editor's picker groups languages, in the order it shows the groups. */
export const LANGUAGE_CATEGORIES = [
  'Web',
  'Systems',
  'Scripting',
  'Data',
  'Config',
  'Shell',
  'Markup',
  'Other',
] as const

export type LanguageCategory = (typeof LANGUAGE_CATEGORIES)[number]

export interface CodeLanguage {
  /** The canonical fence name, and what the editor writes onto a block. */
  readonly id: string
  /** What a reader calls it. */
  readonly label: string
  /** Other fence names that mean it, including its grammar key where that differs. */
  readonly aliases: readonly string[]
  /** File extensions, without the dot, that a tab's `title="main.go"` is read by. */
  readonly extensions: readonly string[]
  /** Whole file names that carry no extension, such as `Dockerfile`, lower-cased. */
  readonly filenames?: readonly string[]
  readonly category: LanguageCategory
  /** The Prism grammar key `tokenize` is called with. */
  readonly grammar: string
}

/** Ordered by label, because that is the order a reader scans them in. */
export const CODE_LANGUAGES = [
  {
    id: 'bash',
    label: 'Bash',
    aliases: ['sh', 'shell', 'shellscript', 'zsh', 'console', 'shell-session', 'curl', 'terminal'],
    extensions: ['sh', 'bash', 'zsh'],
    category: 'Shell',
    grammar: 'bash',
  },
  {
    id: 'csharp',
    label: 'C#',
    aliases: ['cs', 'c#', 'dotnet'],
    extensions: ['cs', 'csx'],
    category: 'Systems',
    grammar: 'csharp',
  },
  { id: 'css', label: 'CSS', aliases: [], extensions: ['css'], category: 'Web', grammar: 'css' },
  {
    id: 'diff',
    label: 'Diff',
    aliases: ['patch'],
    extensions: ['diff', 'patch'],
    category: 'Other',
    grammar: 'diff',
  },
  {
    id: 'docker',
    label: 'Dockerfile',
    aliases: ['dockerfile', 'containerfile'],
    extensions: ['dockerfile'],
    filenames: ['dockerfile', 'containerfile'],
    category: 'Config',
    grammar: 'docker',
  },
  {
    id: 'go',
    label: 'Go',
    aliases: ['golang'],
    extensions: ['go'],
    category: 'Systems',
    grammar: 'go',
  },
  {
    id: 'html',
    label: 'HTML',
    aliases: ['htm', 'markup', 'xml', 'xhtml', 'svg'],
    extensions: ['html', 'htm', 'xhtml', 'xml', 'svg'],
    category: 'Markup',
    grammar: 'markup',
  },
  {
    id: 'java',
    label: 'Java',
    aliases: [],
    extensions: ['java'],
    category: 'Systems',
    grammar: 'java',
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    aliases: ['js', 'mjs', 'cjs', 'node'],
    extensions: ['js', 'mjs', 'cjs'],
    category: 'Web',
    grammar: 'javascript',
  },
  {
    id: 'jsx',
    label: 'JavaScript (JSX)',
    aliases: [],
    extensions: ['jsx'],
    category: 'Web',
    grammar: 'jsx',
  },
  {
    id: 'json',
    label: 'JSON',
    aliases: ['jsonc', 'json5'],
    extensions: ['json', 'jsonc', 'json5'],
    category: 'Data',
    grammar: 'json',
  },
  {
    id: 'markdown',
    label: 'Markdown',
    aliases: ['md', 'mdx'],
    extensions: ['md', 'markdown', 'mdx'],
    category: 'Markup',
    grammar: 'markdown',
  },
  {
    id: 'python',
    label: 'Python',
    aliases: ['py', 'python3'],
    extensions: ['py', 'pyi'],
    category: 'Scripting',
    grammar: 'python',
  },
  {
    id: 'rust',
    label: 'Rust',
    aliases: ['rs'],
    extensions: ['rs'],
    category: 'Systems',
    grammar: 'rust',
  },
  {
    id: 'sql',
    label: 'SQL',
    aliases: ['postgresql', 'postgres', 'psql', 'mysql', 'sqlite'],
    extensions: ['sql'],
    category: 'Data',
    grammar: 'sql',
  },
  {
    id: 'toml',
    label: 'TOML',
    aliases: [],
    extensions: ['toml'],
    category: 'Config',
    grammar: 'toml',
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    aliases: ['ts', 'mts', 'cts'],
    extensions: ['ts', 'mts', 'cts'],
    category: 'Web',
    grammar: 'typescript',
  },
  {
    id: 'tsx',
    label: 'TypeScript (JSX)',
    aliases: [],
    extensions: ['tsx'],
    category: 'Web',
    grammar: 'tsx',
  },
  {
    id: 'yaml',
    label: 'YAML',
    aliases: ['yml'],
    extensions: ['yaml', 'yml'],
    category: 'Config',
    grammar: 'yaml',
  },
] as const satisfies readonly CodeLanguage[]

/** A grammar key some language is tokenized by. */
export type SupportedLanguage = (typeof CODE_LANGUAGES)[number]['grammar']

/** Every grammar key the registry names, once each, in registry order. */
export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  ...new Set(CODE_LANGUAGES.map((language) => language.grammar)),
]

/** One registry entry, with its grammar narrowed to a key `tokenize` knows. */
export type RegisteredLanguage = CodeLanguage & { readonly grammar: SupportedLanguage }

const BY_NAME: ReadonlyMap<string, RegisteredLanguage> = new Map(
  CODE_LANGUAGES.flatMap((language: RegisteredLanguage) =>
    [language.id, ...language.aliases].map((name) => [name, language] as const),
  ),
)

const BY_FILE: ReadonlyMap<string, RegisteredLanguage> = new Map(
  CODE_LANGUAGES.flatMap((language: RegisteredLanguage) =>
    [...language.extensions.map((extension) => `.${extension}`), ...(language.filenames ?? [])].map(
      (name) => [name, language] as const,
    ),
  ),
)

/** The entry a fence name means, or undefined for an unnamed or unknown one. */
export function resolveCodeLanguage(
  name: string | null | undefined,
): RegisteredLanguage | undefined {
  return name === null || name === undefined ? undefined : BY_NAME.get(name.trim().toLowerCase())
}

/** The grammar key a fence name is tokenized by, or null when no grammar knows it. */
export function resolveLanguage(name: string): SupportedLanguage | null {
  return resolveCodeLanguage(name)?.grammar ?? null
}

/** What a reader calls the language a fence names, when anything here knows it. */
export function languageLabel(name: string | null | undefined): string | undefined {
  return resolveCodeLanguage(name)?.label
}

/**
 * The language a file is written in, from its name: a whole name such as
 * `Dockerfile` first, then its extension.
 */
export function languageForFile(path: string): RegisteredLanguage | undefined {
  const file = path.replace(/^.*[\\/]/u, '').toLowerCase()
  const dot = file.lastIndexOf('.')
  return BY_FILE.get(file) ?? (dot === -1 ? undefined : BY_FILE.get(file.slice(dot)))
}
