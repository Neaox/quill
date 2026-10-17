import type { ThemePreference } from '@quill/ui'

/**
 * The reader's colour schemes, in the order every control offers them
 * (ADR-028, layer 3): `system` first, because it is the default and most
 * people have already made that choice once.
 *
 * One list, read by the toggle on the signed-out pages and the design
 * showcase (`theme-toggle.tsx`) and by the person menu's Appearance row, so
 * the two can never name or order the schemes differently.
 */
export const COLOUR_SCHEMES: readonly {
  readonly value: ThemePreference
  readonly label: string
}[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** The scheme after `current`, in the order every control offers them, and back to the first. */
export function nextColourScheme(current: ThemePreference): ThemePreference {
  const at = COLOUR_SCHEMES.findIndex((scheme) => scheme.value === current)
  return COLOUR_SCHEMES[(at + 1) % COLOUR_SCHEMES.length]?.value ?? 'system'
}

/** A scheme's name, as every control says it. */
export function colourSchemeLabel(value: ThemePreference): string {
  return COLOUR_SCHEMES.find((scheme) => scheme.value === value)?.label ?? 'System'
}
