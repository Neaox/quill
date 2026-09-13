import type { Palette } from '../colour/palette.ts'
import type { Colour } from '../colour/oklch.ts'
import { apcaLc } from '../contrast/apca.ts'
import { CONTRAST_FLOORS, type ContrastFloor } from '../contrast/floors.ts'
import { contrastRatio } from '../contrast/wcag.ts'

export type Pair = {
  readonly label: string
  readonly foreground: Colour
  readonly background: Colour
  readonly floor: ContrastFloor
}

/** Every foreground/background pair the product actually renders. */
export const textPairs = (palette: Palette): readonly Pair[] => {
  const { colours } = palette
  return [
    {
      label: 'ink on paper',
      foreground: colours.ink,
      background: colours.paper,
      floor: CONTRAST_FLOORS.body,
    },
    {
      label: 'ink on surface',
      foreground: colours.ink,
      background: colours.surface,
      floor: CONTRAST_FLOORS.body,
    },
    {
      label: 'ink on raised',
      foreground: colours.ink,
      background: colours.raised,
      floor: CONTRAST_FLOORS.body,
    },
    {
      label: 'ink on selection',
      foreground: colours.ink,
      background: colours.selection,
      floor: CONTRAST_FLOORS.body,
    },
    {
      label: 'muted on paper',
      foreground: colours.muted,
      background: colours.paper,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'muted on surface',
      foreground: colours.muted,
      background: colours.surface,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'accent on paper',
      foreground: colours.accent,
      background: colours.paper,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'accent on surface',
      foreground: colours.accent,
      background: colours.surface,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'accent on accent-subtle',
      foreground: colours.accent,
      background: colours.accentSubtle,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'accent foreground on accent',
      foreground: colours.accentForeground,
      background: colours.accent,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'accent foreground on accent hover',
      foreground: colours.accentForeground,
      background: colours.accentHover,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'ink on accent-subtle',
      foreground: colours.ink,
      background: colours.accentSubtle,
      floor: CONTRAST_FLOORS.body,
    },
    {
      label: 'ink on success-subtle',
      foreground: colours.ink,
      background: colours.successSubtle,
      floor: CONTRAST_FLOORS.body,
    },
    {
      label: 'ink on warning-subtle',
      foreground: colours.ink,
      background: colours.warningSubtle,
      floor: CONTRAST_FLOORS.body,
    },
    {
      label: 'ink on danger-subtle',
      foreground: colours.ink,
      background: colours.dangerSubtle,
      floor: CONTRAST_FLOORS.body,
    },
    {
      label: 'success on paper',
      foreground: colours.success,
      background: colours.paper,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'success on success-subtle',
      foreground: colours.success,
      background: colours.successSubtle,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'warning on paper',
      foreground: colours.warning,
      background: colours.paper,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'warning on warning-subtle',
      foreground: colours.warning,
      background: colours.warningSubtle,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'danger on paper',
      foreground: colours.danger,
      background: colours.paper,
      floor: CONTRAST_FLOORS.secondary,
    },
    {
      label: 'danger on danger-subtle',
      foreground: colours.danger,
      background: colours.dangerSubtle,
      floor: CONTRAST_FLOORS.secondary,
    },
  ]
}

/** Non-text pairs: the focus ring and the strong border against every surface. */
export const boundaryPairs = (palette: Palette): readonly Pair[] => {
  const { colours } = palette
  return [
    {
      label: 'focus ring on paper',
      foreground: colours.focusRing,
      background: colours.paper,
      floor: CONTRAST_FLOORS.nonText,
    },
    {
      label: 'focus ring on surface',
      foreground: colours.focusRing,
      background: colours.surface,
      floor: CONTRAST_FLOORS.nonText,
    },
    {
      label: 'focus ring on raised',
      foreground: colours.focusRing,
      background: colours.raised,
      floor: CONTRAST_FLOORS.nonText,
    },
    {
      label: 'strong border on paper',
      foreground: colours.borderStrong,
      background: colours.paper,
      floor: CONTRAST_FLOORS.nonText,
    },
    {
      label: 'strong border on surface',
      foreground: colours.borderStrong,
      background: colours.surface,
      floor: CONTRAST_FLOORS.nonText,
    },
  ]
}

/** Syntax token colours against the code background they always sit on. */
export const syntaxPairs = (palette: Palette): readonly Pair[] =>
  Object.entries(palette.syntax).map(([family, colour]) => ({
    label: `token ${family} on code background`,
    foreground: colour,
    background: palette.colours.codeBackground,
    floor: CONTRAST_FLOORS.secondary,
  }))

export const ratioOf = (pair: Pair): number => contrastRatio(pair.foreground, pair.background)

export const lcOf = (pair: Pair): number => apcaLc(pair.foreground, pair.background)

export const holds = (pair: Pair): boolean =>
  ratioOf(pair) >= pair.floor.ratio && lcOf(pair) >= pair.floor.lc

export const describe = (pair: Pair): string =>
  `${pair.label} is ${ratioOf(pair).toFixed(2)}:1 and Lc ${lcOf(pair).toFixed(
    0,
  )}, below ${pair.floor.ratio}:1 and Lc ${pair.floor.lc}`
