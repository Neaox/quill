import { useState } from 'react'
import type { ReactNode } from 'react'

import { Button, cx } from '@quill/ui'
import type { ThemePreference } from '@quill/ui'

import { colourSchemeLabel, nextColourScheme } from './colour-schemes.ts'
import { MoonIcon, SunIcon, SystemIcon } from './theme-icons.tsx'

/** The picture of each scheme: a device for "follow the system", a sun, a moon. */
export const SCHEME_ICONS: Readonly<Record<ThemePreference, ReactNode>> = {
  system: <SystemIcon />,
  light: <SunIcon />,
  dark: <MoonIcon />,
}

export interface ThemeToggleProps {
  readonly preference: ThemePreference
  readonly onPreferenceChange: (preference: ThemePreference) => void
  readonly className?: string
}

/**
 * The reader's colour scheme (ADR-028, layer 3), as one button that goes round the three.
 *
 * Three states, not two: `system` is "follow the operating system", and it is the default because
 * most people have already made that choice once, which is also why it comes first. The button
 * shows the scheme it is on as its icon and is named by it ("Colour scheme: Dark"); what pressing
 * it does is its description ("Switch to System"), shown as its tooltip. The focus stays on it
 * as the scheme changes, so a polite status says the new one, which a screen reader would not
 * otherwise hear.
 */
export function ThemeToggle({ preference, onPreferenceChange, className }: ThemeToggleProps) {
  const [said, setSaid] = useState('')
  const next = nextColourScheme(preference)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="md"
        // A square: an icon alone, with the room a pointer and a thumb need.
        className={cx('size-8 px-0', className)}
        aria-label={`Colour scheme: ${colourSchemeLabel(preference)}`}
        title={`Switch to ${colourSchemeLabel(next)}`}
        onClick={() => {
          setSaid(`Colour scheme: ${colourSchemeLabel(next)}`)
          onPreferenceChange(next)
        }}
      >
        {SCHEME_ICONS[preference]}
      </Button>
      <span role="status" className="sr-only">
        {said}
      </span>
    </>
  )
}
