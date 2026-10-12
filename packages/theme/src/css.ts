import type { GeneratedTheme } from './generate.ts'
import { labelDeclarations, labelRules, type GeneratedLabel } from './label-css.ts'
import type { TokenMap } from './tokens.ts'

export type CssOptions = {
  /** The element the theme is scoped to. Defaults to `:root`, as in tokens.css. */
  readonly selector?: string
}

const DEFAULT_SELECTOR = ':root'

const declarations = (tokens: TokenMap, indent: string): string =>
  Object.entries(tokens)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n')

const block = (
  selector: string,
  scheme: 'light' | 'dark',
  tokens: TokenMap,
  labels: readonly GeneratedLabel[],
  indent = '',
): string =>
  [
    `${indent}${selector} {`,
    `${indent}  color-scheme: ${scheme};`,
    '',
    declarations(tokens, `${indent}  `),
    // A theme without labels writes exactly what it wrote before them.
    ...(labels.length === 0 ? [] : [labelDeclarations(labels, scheme, `${indent}  `)]),
    `${indent}}`,
  ].join('\n')

/**
 * Emit the custom-property blocks in the resolution order `tokens.css`
 * documents: light at the root, dark under the operating-system preference
 * unless an explicit light choice overrides it, then dark and light as
 * explicit choices. "Follow the system" is the absence of the attribute, so
 * the media block must come before the attribute blocks.
 *
 * A theme's labels (ADR-037) are declared in the same blocks, so they follow
 * the scheme exactly as the palette does, and the rules that read them close
 * the sheet, scoped to the same selector.
 */
export const toCss = (generated: GeneratedTheme, options: CssOptions = {}): string => {
  const selector = options.selector ?? DEFAULT_SELECTOR
  const { labels } = generated
  return [
    block(selector, 'light', generated.light, labels),
    '',
    '@media (prefers-color-scheme: dark) {',
    block(`${selector}:not([data-theme='light'])`, 'dark', generated.dark, labels, '  '),
    '}',
    '',
    block(`${selector}[data-theme='dark']`, 'dark', generated.dark, labels),
    '',
    `${selector}[data-theme='light'] {`,
    '  color-scheme: light;',
    '}',
    '',
    ...(labels.length === 0 ? [] : [labelRules(labels, selector), '']),
  ].join('\n')
}
