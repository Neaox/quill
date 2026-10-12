import { useId } from 'react'

import { tv } from '@quill/ui'

import { useCustomProperty } from '../../lib/dom/use-custom-property.ts'

export const rangeFieldStyles = tv({
  slots: {
    root: 'flex flex-col gap-1',
    header: 'flex items-baseline justify-between gap-2',
    label: 'text-xs font-medium text-foreground',
    value: 'font-mono text-2xs text-muted',
    detail: 'ms-1.5 font-mono text-2xs text-muted',
    control: [
      'h-4 w-full cursor-pointer accent-accent',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'disabled:cursor-not-allowed disabled:opacity-60',
    ],
    description: 'text-2xs leading-normal text-muted',
  },
  variants: {
    /**
     * A track that shows the values it chooses between — a colour slider's
     * spectrum — painted from `--track`, with a plain thumb that sits on it
     * in both schemes. The pseudo-elements have no Tailwind variant of their
     * own, so they are the one place this spells one out.
     */
    painted: {
      true: {
        value: 'font-sans text-xs text-foreground',
        control: [
          'h-3 appearance-none rounded-full bg-(image:--track) ring-1 ring-border ring-inset',
          '[&::-webkit-slider-thumb]:size-4.5 [&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2',
          '[&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-raised',
          '[&::-webkit-slider-thumb]:ring-1 [&::-webkit-slider-thumb]:ring-black/30',
          '[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full',
          '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white',
          '[&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:shadow-raised',
        ],
      },
    },
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
  /** The exact number, quieter, beside a `display` in words: "Teal" and then "184°". */
  readonly detail?: string
  /** A CSS image for the track that shows what the slider chooses between. */
  readonly track?: string
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
  detail,
  track,
  description,
  disabled = false,
}: RangeFieldProps) {
  const id = useId()
  const descriptionId = `${id}-description`
  const styles = rangeFieldStyles({ painted: track !== undefined })
  const paintTrack = useCustomProperty('--track', track ?? 'none')

  return (
    <div className={styles.root()}>
      <div className={styles.header()}>
        <label htmlFor={id} className={styles.label()}>
          {label}
        </label>
        <output htmlFor={id} className={styles.value()}>
          {display ?? String(value)}
          {detail === undefined ? undefined : <span className={styles.detail()}>{detail}</span>}
        </output>
      </div>
      <input
        type="range"
        ref={paintTrack}
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
