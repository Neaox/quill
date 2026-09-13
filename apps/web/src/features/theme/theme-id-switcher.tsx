import { themeIdName, THEME_IDS } from '@quill/ui/theme'

import type { BuiltinThemeId } from '@quill/theme'

import { SegmentedControl, type Segment } from './segmented-control.tsx'

const SEGMENTS: readonly Segment<BuiltinThemeId>[] = THEME_IDS.map((id) => ({
  value: id,
  label: themeIdName(id),
}))

export interface ThemeIdSwitcherProps {
  readonly themeId: BuiltinThemeId
  readonly onThemeIdChange: (id: BuiltinThemeId) => void
  readonly className?: string
}

/**
 * The tenant's identity (ADR-028, layer 1).
 *
 * Each option is a complete theme: a type pairing, a palette generated from
 * its own seeds, and its own signature variants. Switching is a change of one
 * attribute on the document element and a repaint — no second stylesheet, no
 * rebuild.
 */
export function ThemeIdSwitcher({ themeId, onThemeIdChange, className }: ThemeIdSwitcherProps) {
  return (
    <SegmentedControl
      legend="Identity"
      segments={SEGMENTS}
      value={themeId}
      onValueChange={onThemeIdChange}
      className={className}
    />
  )
}
