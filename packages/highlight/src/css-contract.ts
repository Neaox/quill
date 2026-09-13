/**
 * The CSS contract between this package and the UI package's stylesheet
 * (ADR-030): the exact `--token-*` variables, `.tok-*` selectors, and
 * `::highlight()` selectors a theme must colour, plus the coverage query a
 * theme test runs against a specific grammar. Neither package hand-copies
 * the other's list — both read `TOKEN_CLASSES` through here.
 */
import { Prism, type PrismTypes, type SupportedLanguage } from './grammars.ts'
import {
  TOKEN_CLASSES,
  TOKEN_CLASS_PREFIX,
  TOKEN_HIGHLIGHT_PREFIX,
  resolveTokenClass,
} from './tokens.ts'

export interface TokenCssContract {
  /** `--token-punctuation`, `--token-comment`, … in `TOKEN_CLASSES` order. */
  readonly variables: readonly string[]
  /** `.tok-punctuation`, `.tok-comment`, … in `TOKEN_CLASSES` order. */
  readonly classSelectors: readonly string[]
  /** `::highlight(<brand slug>-tok-punctuation)`, … in `TOKEN_CLASSES` order. */
  readonly highlightSelectors: readonly string[]
}

/** The full set of names and selectors a theme must define, once each. */
export function tokenCssContract(): TokenCssContract {
  return {
    variables: TOKEN_CLASSES.map((tokenClass) => `--token-${tokenClass}`),
    classSelectors: TOKEN_CLASSES.map((tokenClass) => `.${TOKEN_CLASS_PREFIX}${tokenClass}`),
    highlightSelectors: TOKEN_CLASSES.map(
      (tokenClass) => `::highlight(${TOKEN_HIGHLIGHT_PREFIX}${tokenClass})`,
    ),
  }
}

/**
 * Every group of class names `language`'s grammar can emit *together*: a rule's
 * own name followed by its aliases, and the same recursively through `inside`
 * sub-grammars and `rest`.
 *
 * Groups, not bare names, are what a token actually carries at runtime — Prism
 * puts a rule's `type` and its `alias` list on the same token — so this is the
 * shape `resolveTokenClass` is fed and the shape the coverage test has to check.
 * Asking whether `deleted-sign` alone is themed answers the wrong question: the
 * diff grammar never emits it without `deleted` beside it.
 */
export function grammarTokenGroups(language: SupportedLanguage): string[][] {
  const groups: string[][] = []
  // Every SupportedLanguage is registered by grammars.ts (pinned by
  // grammars.test.ts); the index signature just can't express that.
  const grammar = Prism.languages[language] as PrismTypes.Grammar
  const seen = new Set<PrismTypes.Grammar>()
  const visit = (node: PrismTypes.Grammar): void => {
    if (seen.has(node)) return
    seen.add(node)
    for (const [name, value] of Object.entries(node)) {
      if (name === 'rest') {
        visit(value as PrismTypes.Grammar)
        continue
      }
      for (const pattern of Array.isArray(value) ? value : [value]) {
        if (pattern instanceof RegExp || pattern == null) {
          groups.push([name])
          continue
        }
        const { alias, inside } = pattern
        groups.push([name, ...(alias == null ? [] : Array.isArray(alias) ? alias : [alias])])
        if (inside != null) visit(inside)
      }
    }
  }
  visit(grammar)
  return groups
}

/**
 * Every raw class name `language`'s grammar can emit: rule names, their
 * aliases, and the same recursively through `inside` sub-grammars.
 *
 * The flattened view of `grammarTokenGroups`, kept because a stylesheet cares
 * which names exist at all. Coverage is checked against the groups.
 */
export function grammarTokenClasses(language: SupportedLanguage): Set<string> {
  return new Set(grammarTokenGroups(language).flat())
}

/** One group's stable name, so a reviewed allowlist can be written down. */
export function tokenGroupKey(group: readonly string[]): string {
  return group.join('+')
}

/**
 * The groups a grammar can emit that resolve to no themed class, sorted and
 * deduplicated. The coverage test checks this against the reviewed allowlist
 * below, so a grammar upgrade that starts emitting something new fails the
 * build instead of rendering it uncoloured.
 */
export function unthemedTokenGroups(language: SupportedLanguage): string[] {
  return [
    ...new Set(
      grammarTokenGroups(language)
        .filter((group) => resolveTokenClass(group) === null)
        .map(tokenGroupKey),
    ),
  ].toSorted()
}

// Markup's own container rules, shared by every grammar that extends or embeds
// it. `script`, `style`, `included-cdata`, the `language-*` wrappers and the
// `value+…` pairs exist to hand a span to another grammar, whose tokens carry
// their own classes; `doctype-tag`, `internal-subset`, `name`, `rule` and
// `special-attr` name a part of a construct whose own token is themed, so the
// part takes that colour by the inheritance rule in `tokenize.ts`. `namespace`
// is Prism's own deliberate exception: its theme dims a namespace rather than
// giving it a hue.
const MARKUP_CONTAINERS = [
  'doctype-tag',
  'included-cdata',
  'internal-subset',
  'language-css',
  'language-javascript',
  'name',
  'namespace',
  'rule',
  'script',
  'special-attr',
  'style',
  'value+css+language-css',
  'value+javascript+language-javascript',
] as const

// The three parts of a JavaScript regular expression literal. The literal's own
// `regex` token is themed and these take its colour.
const REGEX_PARTS = ['regex-delimiter', 'regex-flags', 'regex-source+language-regex'] as const

/**
 * The classes each grammar can emit that this package deliberately leaves
 * uncoloured, reviewed one by one.
 *
 * Every entry is here for one of three reasons, named in the comment beside it:
 * it is a **container** that exists only to hand its span to another grammar or
 * to a nested rule that carries its own class; it is a **part** of a construct
 * whose enclosing token is themed, so it inherits that colour (`tokenize.ts`);
 * or Prism's own theme leaves it at the reader's text colour on purpose.
 *
 * This is an allowlist, not a filter: the coverage test asserts the unresolved
 * set is exactly this, so a new grammar class shows up as a failure and has to
 * be either themed (`TOKEN_CLASS_ALIASES`) or reviewed into this list.
 */
export const REVIEWED_UNTHEMED_GROUPS: Readonly<Record<SupportedLanguage, readonly string[]>> = {
  markup: [...MARKUP_CONTAINERS, ...REGEX_PARTS],
  css: ['rule'], // the `@media` of an `atrule`, which is themed
  javascript: [...REGEX_PARTS],
  // `decorator` and `generic-function` wrap an `at`/`function`/`generic` that
  // each carry their own class.
  typescript: [...REGEX_PARTS, 'decorator', 'generic-function'],
  jsx: [...MARKUP_CONTAINERS, ...REGEX_PARTS, 'script+language-javascript'],
  tsx: [
    ...MARKUP_CONTAINERS,
    ...REGEX_PARTS,
    'decorator',
    'generic-function',
    'script+language-javascript',
  ],
  json: [],
  yaml: [],
  bash: [],
  // An f-string is a container of `interpolation` and `string`; `format-spec`
  // is the `:>10.2f` inside a hole and takes the hole's colour.
  python: ['format-spec', 'string-interpolation'],
  go: [],
  // `closure-params` wraps its own punctuation and the rest of the grammar.
  rust: ['closure-params', 'module-declaration+namespace', 'namespace'],
  // `generics`, `import` and `static` wrap class names, namespaces and keywords.
  java: ['generics', 'import', 'import+static', 'namespace', 'static'],
  csharp: [
    'attribute', // wraps `target`, `class-name` and its arguments
    'attribute-arguments',
    'expression+language-csharp',
    'generic-method',
    'interpolation-string', // wraps `interpolation` and `string`
    'namespace',
    'record-arguments',
    'type-list',
  ],
  sql: [],
  markdown: [
    ...MARKUP_CONTAINERS,
    ...REGEX_PARTS,
    // A fenced block hands its body to no grammar at all: Markdown does not
    // know the fence's language, so the body reads as plain monospace text.
    'code',
    'code-block',
    'code-language',
    'content', // the text inside `bold`, `italic` or `strike`
    'front-matter+yaml+language-yaml',
    'front-matter-block',
    // A table is punctuation and cells; `table-header` alone is emphasised.
    'table',
    'table-data',
    'table-data-rows',
    'table-header-row',
    'table-line',
  ],
  // A changed line takes its block's colour; an unchanged one is context and
  // reads as ordinary text.
  diff: ['line', 'prefix+diff', 'prefix+unchanged', 'unchanged'],
  docker: ['options'], // `--from=build`, whose property and string are themed
  toml: [],
}
