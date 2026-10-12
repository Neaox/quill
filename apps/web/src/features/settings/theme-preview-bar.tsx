import { useId, useRef, useState, type ReactNode } from 'react'

import { Button, Dialog, tv } from '@quill/ui'

import type { TokenMap } from '@quill/theme'

import { SegmentedControl } from '../theme/segmented-control.tsx'
import { SettingsActionBar } from './settings-action-bar.tsx'
import type { DoctorSummary } from './doctor/doctor-copy.ts'
import { DoctorVerdict } from './doctor/doctor-verdict.tsx'
import { ThemePreview } from './theme-preview.tsx'

type Scheme = 'light' | 'dark'

const SCHEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const satisfies readonly { readonly value: Scheme; readonly label: string }[]

export const themePreviewBarStyles = tv({
  slots: {
    // `shrink` over the button's own `shrink-0`: on a 320-pixel phone the
    // verdict truncates and Save stays on screen, rather than the reverse.
    open: 'min-w-0 shrink grow justify-start sm:max-w-sm',
    openText: 'flex min-w-0 flex-col items-start leading-tight',
    summary: 'max-w-full truncate font-normal',
    sheetBody: 'flex flex-col gap-4',
  },
})

export interface ThemePreviewBarProps {
  readonly light: TokenMap
  readonly dark: TokenMap
  readonly summary: DoctorSummary
  /** Takes the reader to the report's warnings, once the sheet has closed. */
  readonly onReview: () => void
  /** The screen's Save, which lives on the bar on a phone. */
  readonly save: ReactNode
}

/**
 * The theme editor's preview on a phone or a narrow tablet.
 *
 * On a desktop the preview sits beside the levers and stays in view while
 * they scroll, both schemes at once. Below the compact breakpoint there is no
 * "beside", and a preview stacked under a long column of sliders is a preview
 * nobody sees while moving one. So it moves behind a bar held to the bottom
 * of the viewport: the doctor's verdict is always on the bar, so a lever that
 * breaks a rule says so without opening anything, and one tap opens the
 * document in a sheet, one scheme at a time (half of a phone is too narrow to
 * judge a measure in), with the scheme a segmented control inside it.
 *
 * The sheet is the shared `Dialog` at its `sheet` placement, so focus,
 * Escape, the inert page behind it and the return of focus to the bar are the
 * primitive's, not this component's.
 */
export function ThemePreviewBar({ light, dark, summary, onReview, save }: ThemePreviewBarProps) {
  const [open, setOpen] = useState(false)
  const [scheme, setScheme] = useState<Scheme>('light')
  // Set by "to check": the sheet closes onto the report rather than back onto the bar.
  const reviewing = useRef(false)
  const summaryId = useId()
  const styles = themePreviewBarStyles()

  return (
    <SettingsActionBar label="Theme actions">
      <Dialog
        open={open}
        onOpenChange={setOpen}
        placement="sheet"
        title="Preview"
        description={
          <DoctorVerdict
            summary={summary}
            onReview={() => {
              reviewing.current = true
              setOpen(false)
            }}
          />
        }
        onCloseAutoFocus={(event) => {
          if (!reviewing.current) return
          reviewing.current = false
          event.preventDefault()
          onReview()
        }}
        trigger={
          <Button
            variant="secondary"
            size="xl"
            className={styles.open()}
            aria-label="Preview"
            aria-describedby={summaryId}
          >
            <span className={styles.openText()}>
              <span>Preview</span>
              <span className={styles.summary()}>
                <DoctorVerdict id={summaryId} summary={summary} variant="compact" />
              </span>
            </span>
          </Button>
        }
      >
        <div className={styles.sheetBody()}>
          <SegmentedControl
            legend="Scheme"
            segments={SCHEMES}
            value={scheme}
            onValueChange={setScheme}
            size="touch"
          />
          <ThemePreview light={light} dark={dark} scheme={scheme} />
        </div>
      </Dialog>
      {save}
    </SettingsActionBar>
  )
}
