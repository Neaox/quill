import type { ThemePreference } from '@quill/ui'

/**
 * The reader's colour schemes, in the order every control offers them
 * (ADR-028, layer 3): `system` first, because it is the default and most
 * people have already made that choice once.
 *
 * One list, read by the segmented switch on the signed-out pages and the
 * design showcase (`theme-toggle.tsx`) and by the person menu's Appearance
 * group, so the two can never name or order the schemes differently.
 */
export const COLOUR_SCHEMES: readonly {
  readonly value: ThemePreference
  readonly label: string
}[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
