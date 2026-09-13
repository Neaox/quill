import type { ThemePreference } from '@quill/ui'

import { SegmentedControl, type Segment } from './segmented-control.tsx'
import { MoonIcon, SunIcon, SystemIcon } from './theme-icons.tsx'

const SEGMENTS: readonly Segment<ThemePreference>[] = [
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'system', label: 'System', icon: <SystemIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
]

export interface ThemeToggleProps {
  readonly preference: ThemePreference
  readonly onPreferenceChange: (preference: ThemePreference) => void
  readonly className?: string
}

/**
 * The reader's colour scheme (ADR-028, layer 3).
 *
 * Three states, not two: `system` is "follow the operating system", and it is
 * the default because most people have already made that choice once.
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
