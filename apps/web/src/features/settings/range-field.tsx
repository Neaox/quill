import { useId } from 'react'

import { tv } from '@quill/ui'

export const rangeFieldStyles = tv({
  slots: {
    root: 'flex flex-col gap-1',
    header: 'flex items-baseline justify-between gap-2',
    label: 'text-xs font-medium text-foreground',
    value: 'font-mono text-2xs text-muted',
    control: [
      'h-4 w-full cursor-pointer accent-accent',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'disabled:cursor-not-allowed disabled:opacity-60',
    ],
    description: 'text-2xs leading-normal text-muted',
  },
})

export interface RangeFieldProps {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly onValueChange: (value: number) => void
  /** The number as a person reads it: "45°", "0.2", "Comfortable". */
  readonly display?: string
  readonly description?: string
  readonly disabled?: boolean
}

/**
 * One numeric lever of a theme (ADR-028, layer 2): a hue, a chroma, a radius
 * step.
 *
 * A native `input[type=range]`, so the keyboard, the pointer and assistive
 * technology all get the behaviour the platform already has — arrow keys,
 * Home and End, the value announced as it changes — rather than a rebuilt
 * slider. The current value is also rendered as text beside the label,
 * because a slider alone does not tell you that the accent hue is 45 when you
 * want to write it down.
 */
export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onValueChange,
  display,
  description,
  disabled = false,
}: RangeFieldProps) {
  const id = useId()
  const descriptionId = `${id}-description`
  const styles = rangeFieldStyles()

  return (
    <div className={styles.root()}>
      <div className={styles.header()}>
        <label htmlFor={id} className={styles.label()}>
          {label}
        </label>
        <output htmlFor={id} className={styles.value()}>
          {display ?? String(value)}
        </output>
      </div>
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={description === undefined ? undefined : descriptionId}
        className={styles.control()}
        onChange={(event) => {
          onValueChange(Number(event.target.value))
        }}
      />
      {description === undefined ? undefined : (
        <p id={descriptionId} className={styles.description()}>
          {description}
        </p>
      )}
    </div>
  )
}
