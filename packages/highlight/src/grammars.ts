/**
 * The registered Prism grammars, and the mapping from fence-name aliases to
 * the canonical language key `tokenize` looks them up by.
 *
 * Importing this module registers every grammar below as a side effect —
 * `Prism.languages.<key>` is populated the moment it loads — which is why it
 * is the only module in this package that imports "prismjs" or a component:
 * every other module reaches the configured `Prism` through here, so the
 * grammars are registered exactly once no matter how many entry points a
 * bundler sees.
 *
 * Nothing here touches the DOM; this module is safe on the server and in a
 * worker (ADR-030).
 */
import * as prismRuntimeGuard from './internal/prism-runtime-guard.ts'
import type * as PrismTypes from 'prismjs'
// `prismjs` is CommonJS with no static named exports `cjs-module-lexer` can
// see (`module.exports = Prism` assigns a variable, not an object literal),
// so under plain Node ESM `import * as Prism from 'prismjs'` yields only the
// synthetic namespace `{ default, 'module.exports' }` — `Prism.languages` is
// `undefined` and every call into Prism throws. A default import asks for
// exactly the CommonJS interop Node's loader already provides for this case:
// `Prism` here is bound to the real `module.exports` object (the same
// instance the components below mutate via the bare global `Prism`), so
// `Prism.languages` is populated. Vite/Vitest's own interop happens to
// spread the namespace either way, which is why this only broke under real
// `node` (the server, the seed script) and never under `pnpm test`.
import Prism from 'prismjs'
/* oxlint-disable import/no-unassigned-import -- prismjs's component files
   have no exports (and no ambient types: @types/prismjs covers the core
   only); importing each purely for its registration side effect, which adds
   its grammar to `Prism.languages`, is exactly the documented way to load
   them. grammars.test.ts checks the resulting registration. */
import 'prismjs/components/prism-clike.js'
import 'prismjs/components/prism-markup.js'
import 'prismjs/components/prism-css.js'
import 'prismjs/components/prism-javascript.js'
import 'prismjs/components/prism-typescript.js'
import 'prismjs/components/prism-jsx.js'
import 'prismjs/components/prism-tsx.js'
import 'prismjs/components/prism-json.js'
import 'prismjs/components/prism-yaml.js'
import 'prismjs/components/prism-bash.js'
import 'prismjs/components/prism-python.js'
import 'prismjs/components/prism-go.js'
import 'prismjs/components/prism-rust.js'
import 'prismjs/components/prism-java.js'
import 'prismjs/components/prism-csharp.js'
import 'prismjs/components/prism-sql.js'
import 'prismjs/components/prism-markdown.js'
import 'prismjs/components/prism-diff.js'
import 'prismjs/components/prism-docker.js'
import 'prismjs/components/prism-toml.js'
/* oxlint-enable import/no-unassigned-import */

export { Prism }
// The type-only counterpart of the default import above: `Prism.Token` and
// `Prism.Grammar` used to work as type positions because `import * as Prism`
// doubled as a namespace both modules could query for types. A default
// import is value-only, so callers that need Prism's types (tokenize.ts,
// css-contract.ts) import this namespace instead.
export type { PrismTypes }

// The guard import above is for its side effect only (see prism-runtime-guard.ts);
// this reference gives the linter a use it can see, without changing behaviour.
void prismRuntimeGuard

/** Canonical grammar keys this package registers, in registration order. */
export const SUPPORTED_LANGUAGES = [
  'markup',
  'css',
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'json',
  'yaml',
  'bash',
  'python',
  'go',
  'rust',
  'java',
  'csharp',
  'sql',
  'markdown',
  'diff',
  'docker',
  'toml',
] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

/**
 * Fence-name aliases (Markdown code-fence tags, file extensions, common
 * shorthand) mapped to the canonical key above. Deliberately independent of
 * whatever aliases the Prism components register for themselves on
 * `Prism.languages` — this is the single source of truth callers resolve
 * against before ever touching a grammar.
 */
const LANGUAGE_ALIASES: Readonly<Record<string, SupportedLanguage>> = {
  html: 'markup',
  htm: 'markup',
  xhtml: 'markup',
  xml: 'markup',
  svg: 'markup',
  markup: 'markup',
  css: 'css',
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  python: 'python',
  py: 'python',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  rs: 'rust',
  java: 'java',
  csharp: 'csharp',
  'c#': 'csharp',
  cs: 'csharp',
  sql: 'sql',
  markdown: 'markdown',
  md: 'markdown',
  diff: 'diff',
  patch: 'diff',
  docker: 'docker',
  dockerfile: 'docker',
  toml: 'toml',
}

/** Maps a fence-name alias to its canonical grammar key, or null when unknown. */
export function resolveLanguage(alias: string): SupportedLanguage | null {
  return LANGUAGE_ALIASES[alias.trim().toLowerCase()] ?? null
}
