import { useId, type ReactNode } from 'react'

import { tv } from '@quill/ui'

/**
 * The radio carries the selection, so `peer-checked:` carries the look: no
 * branch here decides a colour, and the control cannot show one thing while
 * announcing another.
 */
const segmentedControl = tv({
  slots: {
    root: 'flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5',
    segment: 'relative flex',
    // Transparent and covering its whole segment rather than shrunk to a
    // pixel: it stays in the accessibility tree, it is the thing a pointer
    // actually hits, and the label underneath is free to carry the appearance.
    input: 'peer absolute inset-0 z-10 m-0 cursor-default appearance-none opacity-0',
    label: [
      'inline-flex h-6 grow cursor-default items-center justify-center gap-1.5 px-2',
      'rounded-sm font-mono text-2xs tracking-caps text-muted uppercase',
      'transition-[color,background-color] hover:text-foreground',
      'peer-checked:bg-surface-raised peer-checked:text-foreground',
      'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
      'peer-focus-visible:outline-focus-ring',
    ],
    text: '',
  },
  variants: {
    compact: { true: { text: 'sr-only sm:not-sr-only' } },
  },
})

export interface Segment<Value extends string> {
  readonly value: Value
  readonly label: string
  /** Decorative. The label is what is announced. */
  readonly icon?: ReactNode | undefined
}

export interface SegmentedControlProps<Value extends string> {
  /** Names the group. Rendered as the fieldset's legend, visually hidden. */
  readonly legend: string
  readonly segments: readonly Segment<Value>[]
  readonly value: Value
  readonly onValueChange: (value: Value) => void
  /** Hides the labels below the small breakpoint, leaving the icons. */
  readonly compact?: boolean | undefined
  readonly className?: string | undefined
}

/**
 * One control for choosing one of a few things.
 *
 * Built on native radios: one tab stop for the group, arrow keys between the
 * options, and the selected state exposed without any ARIA of our own. Each
 * segment is a fixed size and nothing about it changes with the selection
 * except colour, so choosing repaints and moves nothing.
 *
 * Both theme controls are this component, because they are the same control
 * with different words: the scheme is the reader's (ADR-028, layer 3) and the
 * identity is the tenant's (layer 1), but a segmented control does not care.
 */
export function SegmentedControl<Value extends string>({
  legend,
  segments,
  value,
  onValueChange,
  compact = false,
  className,
}: SegmentedControlProps<Value>) {
  const name = useId()
  const styles = segmentedControl({ compact })

  return (
    <fieldset className={styles.root({ className })}>
      <legend className="sr-only">{legend}</legend>
      {segments.map((segment) => {
        const id = `${name}-${segment.value}`
        return (
          <div key={segment.value} className={styles.segment()}>
            <input
              type="radio"
              id={id}
              name={name}
              value={segment.value}
              checked={segment.value === value}
              onChange={() => {
                onValueChange(segment.value)
              }}
              className={styles.input()}
            />
            <label htmlFor={id} className={styles.label()}>
              {segment.icon}
              <span className={styles.text()}>{segment.label}</span>
            </label>
          </div>
        )
      })}
    </fieldset>
  )
}
