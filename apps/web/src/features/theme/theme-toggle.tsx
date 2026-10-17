import type { ReactNode } from 'react'

import type { ThemePreference } from '@quill/ui'

import { COLOUR_SCHEMES } from './colour-schemes.ts'
import { SegmentedControl, type Segment } from './segmented-control.tsx'
import { MoonIcon, SunIcon, SystemIcon } from './theme-icons.tsx'

const ICONS: Readonly<Record<ThemePreference, ReactNode>> = {
  system: <SystemIcon />,
  light: <SunIcon />,
  dark: <MoonIcon />,
}

const SEGMENTS: readonly Segment<ThemePreference>[] = COLOUR_SCHEMES.map((scheme) => ({
  ...scheme,
  icon: ICONS[scheme.value],
}))

export interface ThemeToggleProps {
  readonly preference: ThemePreference
  readonly onPreferenceChange: (preference: ThemePreference) => void
  readonly className?: string
}

/**
 * The reader's colour scheme (ADR-028, layer 3).
 *
 * Three states, not two: `system` is "follow the operating system", and it is
 * the default because most people have already made that choice once — which
 * is also why it comes first.
 */
export function ThemeToggle({ preference, onPreferenceChange, className }: ThemeToggleProps) {
  return (
    <SegmentedControl
      legend="Theme"
      segments={SEGMENTS}
      value={preference}
      onValueChange={onPreferenceChange}
      compact
      className={className}
    />
  )
}
