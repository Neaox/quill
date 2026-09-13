import { useMemo } from 'react'

import { DataTable } from '@quill/ui'

import {
  BUILTIN_THEMES,
  contrastRatio,
  generateTheme,
  parseColour,
  type BuiltinThemeId,
  type PaletteToken,
  type TokenMap,
} from '@quill/theme'

interface Pair {
  readonly foreground: PaletteToken
  readonly background: PaletteToken
  /** WCAG 2.2: 4.5 for body text, 3 for a control boundary. */
  readonly floor: number
}

const PAIRS: readonly Pair[] = [
  { foreground: '--palette-foreground', background: '--palette-background', floor: 4.5 },
  { foreground: '--palette-foreground', background: '--palette-surface', floor: 4.5 },
  { foreground: '--palette-foreground', background: '--palette-surface-raised', floor: 4.5 },
  { foreground: '--palette-foreground', background: '--palette-code-background', floor: 4.5 },
  { foreground: '--palette-muted', background: '--palette-background', floor: 4.5 },
  { foreground: '--palette-muted', background: '--palette-surface', floor: 4.5 },
  { foreground: '--palette-accent', background: '--palette-background', floor: 4.5 },
  { foreground: '--palette-accent', background: '--palette-surface', floor: 4.5 },
  { foreground: '--palette-accent-foreground', background: '--palette-accent', floor: 4.5 },
  { foreground: '--palette-success', background: '--palette-success-subtle', floor: 4.5 },
  { foreground: '--palette-warning', background: '--palette-warning-subtle', floor: 4.5 },
  { foreground: '--palette-danger', background: '--palette-danger-subtle', floor: 4.5 },
  { foreground: '--palette-border-strong', background: '--palette-background', floor: 3 },
]

interface Row {
  readonly pair: Pair
  readonly light: number | undefined
  readonly dark: number | undefined
}

const ratioIn = (tokens: TokenMap, pair: Pair): number | undefined => {
  const foreground = parseColour(tokens[pair.foreground])
  const background = parseColour(tokens[pair.background])
  if (foreground === undefined || background === undefined) return undefined
  return contrastRatio(foreground, background)
}

const rowsFor = (id: BuiltinThemeId): readonly Row[] => {
  const { light, dark } = generateTheme(BUILTIN_THEMES[id])
  return PAIRS.map((pair) => ({ pair, light: ratioIn(light, pair), dark: ratioIn(dark, pair) }))
}

const show = (ratio: number | undefined): string =>
  ratio === undefined ? '—' : `${ratio.toFixed(2)}:1`

/** A pair passes only if it passes in both schemes: light says nothing about dark. */
const verdict = ({ light, dark, pair }: Row): string => {
  if (light === undefined || dark === undefined) return '—'
  return light >= pair.floor && dark >= pair.floor ? 'pass' : 'below the floor'
}

/** `--palette-foreground` reads as `foreground on background` in the table. */
const name = (token: PaletteToken): string => token.replace('--palette-', '')

export interface ContrastTableProps {
  readonly themeId: BuiltinThemeId
}

/**
 * Every text and boundary pair of the identity on screen, in both schemes.
 *
 * The numbers come from the same generator that produced the palette, so they
 * cannot drift from what is painted: the generator already held each pair to
 * the floors in `docs/design/colour-rules.md` before the theme reached CSS,
 * and this is that guarantee shown rather than asserted. Switch identity and
 * every row is recomputed.
 */
export function ContrastTable({ themeId }: ContrastTableProps) {
  const rows = useMemo(() => rowsFor(themeId), [themeId])

  return (
    <DataTable
      label="Measured contrast"
      caption="Generated from this identity's seeds. AA needs 4.5:1 for text and 3:1 for a control boundary; a pair passes only if it passes in both schemes."
    >
      <thead>
        <tr>
          <th scope="col">pair</th>
          <th scope="col">light</th>
          <th scope="col">dark</th>
          <th scope="col">floor</th>
          <th scope="col">result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.pair.foreground}-on-${row.pair.background}`}>
            <th scope="row" className="font-mono">
              {name(row.pair.foreground)} on {name(row.pair.background)}
            </th>
            <td className="font-mono">{show(row.light)}</td>
            <td className="font-mono">{show(row.dark)}</td>
            <td className="font-mono">{row.pair.floor.toFixed(1)}:1</td>
            <td>{verdict(row)}</td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  )
}
