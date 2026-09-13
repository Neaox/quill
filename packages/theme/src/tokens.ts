/**
 * The custom properties a generated theme emits.
 *
 * The `--palette-*` list is exactly the one `packages/ui/src/styles/tokens.css`
 * declares: the semantic layer there is expressed in terms of these names, so
 * anything missing would resolve to nothing and anything extra would be dead.
 */

export const PALETTE_TOKENS = [
  '--palette-background',
  '--palette-surface',
  '--palette-surface-raised',
  '--palette-foreground',
  '--palette-muted',
  '--palette-border',
  '--palette-border-strong',
  '--palette-accent',
  '--palette-accent-hover',
  '--palette-accent-foreground',
  '--palette-accent-subtle',
  '--palette-success',
  '--palette-success-subtle',
  '--palette-warning',
  '--palette-warning-subtle',
  '--palette-danger',
  '--palette-danger-hover',
  '--palette-danger-subtle',
  '--palette-code-background',
  '--palette-selection',
  '--palette-overlay',
  '--palette-shadow-ambient',
  '--palette-shadow-direct',
] as const

export type PaletteToken = (typeof PALETTE_TOKENS)[number]

/**
 * The syntax token classes of ADR-030. Every class a registered grammar can
 * emit has a variable; classes that share a colour alias one family variable,
 * so each colour is stated once. Every family name is itself a class, which is
 * what makes the family variable and the class variable the same declaration.
 */
export const SYNTAX_CLASSES = [
  'punctuation',
  'operator',
  'comment',
  'keyword',
  'important',
  'tag',
  'selector',
  'bold',
  'number',
  'boolean',
  'null',
  'constant',
  'symbol',
  'string',
  'template-string',
  'attr-value',
  'url',
  'italic',
  'function',
  'class-name',
  'title',
  'variable',
  'property',
  'attr-name',
  'builtin',
  'regex',
  'interpolation',
  'inserted',
  'deleted',
] as const

export type SyntaxClass = (typeof SYNTAX_CLASSES)[number]

export const SYNTAX_FAMILIES = [
  'punctuation',
  'comment',
  'keyword',
  'number',
  'string',
  'function',
  'variable',
  'regex',
  'inserted',
  'deleted',
] as const satisfies readonly SyntaxClass[]

export type SyntaxFamily = (typeof SYNTAX_FAMILIES)[number]

export const SYNTAX_CLASS_FAMILIES: Readonly<Record<SyntaxClass, SyntaxFamily>> = {
  punctuation: 'punctuation',
  operator: 'punctuation',
  comment: 'comment',
  keyword: 'keyword',
  important: 'keyword',
  tag: 'keyword',
  selector: 'keyword',
  bold: 'keyword',
  number: 'number',
  boolean: 'number',
  null: 'number',
  constant: 'number',
  symbol: 'number',
  string: 'string',
  'template-string': 'string',
  'attr-value': 'string',
  url: 'string',
  italic: 'string',
  function: 'function',
  'class-name': 'function',
  title: 'function',
  variable: 'variable',
  property: 'variable',
  'attr-name': 'variable',
  builtin: 'variable',
  regex: 'regex',
  interpolation: 'regex',
  inserted: 'inserted',
  deleted: 'deleted',
}

export type SyntaxToken = `--token-${SyntaxClass}`

export const SYNTAX_TOKENS: readonly SyntaxToken[] = SYNTAX_CLASSES.map(
  (name): SyntaxToken => `--token-${name}`,
)

/** Type, shape and layout. Exports embed these so a saved page looks right offline. */
export const TYPE_TOKENS = [
  '--font-display',
  '--font-sans',
  '--font-reading',
  '--font-mono',
] as const

export const SHAPE_TOKENS = [
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-2xl',
] as const

export const LAYOUT_TOKENS = [
  '--layout-content',
  '--layout-wide',
  '--layout-max',
  '--layout-gutter',
  '--density-scale',
] as const

export type TypeToken = (typeof TYPE_TOKENS)[number]
export type ShapeToken = (typeof SHAPE_TOKENS)[number]
export type LayoutToken = (typeof LAYOUT_TOKENS)[number]

export type TokenName = PaletteToken | SyntaxToken | TypeToken | ShapeToken | LayoutToken

export const TOKEN_NAMES: readonly TokenName[] = [
  ...PALETTE_TOKENS,
  ...SYNTAX_TOKENS,
  ...TYPE_TOKENS,
  ...SHAPE_TOKENS,
  ...LAYOUT_TOKENS,
]

export type TokenMap = Readonly<Record<TokenName, string>>

export type TokenOverrides = Readonly<Partial<Record<TokenName, string>>>
