import { useId, type ReactNode } from 'react'

import { tv } from '@quill/ui'

/**
 * The radio carries the selection, so `peer-checked:` carries the look: no
 * branch here decides a colour, and the control cannot show one thing while
 * announcing another.
 */
const segmentedControl = tv({
  slots: {
    // A well: the track is a step below the page, and the chosen segment is
    // raised out of it onto the brightest surface with the smallest shadow,
    // so the choice reads as an object sitting in a groove rather than as a
    // coloured cell in a table.
    root: 'flex items-center gap-0.5 rounded-lg bg-surface p-0.5',
    segment: 'relative flex',
    // Transparent and covering its whole segment rather than shrunk to a
    // pixel: it stays in the accessibility tree, it is the thing a pointer
    // actually hits, and the label underneath is free to carry the appearance.
    input: 'peer absolute inset-0 z-10 m-0 cursor-default appearance-none opacity-0',
    label: [
      'inline-flex h-7 grow cursor-default items-center justify-center gap-1.5 px-2.5',
      'rounded-md text-xs font-medium text-foreground-soft',
      'transition-[color,background-color,box-shadow] hover:text-foreground',
      'peer-checked:bg-surface-raised peer-checked:text-foreground peer-checked:shadow-raised',
      // A hairline edge, so the raised segment reads as raised in dark mode
      // too, where a shadow on dark paper says nothing (colour rules, section 7).
      'peer-checked:ring-1 peer-checked:ring-border-strong peer-checked:ring-inset',
      'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
      'peer-focus-visible:outline-focus-ring',
    ],
    icon: 'flex',
    text: '',
  },
  variants: {
    /*
     * In a bar that is short of room, the words give way to the pictures
     * until there is space for both — and then the words win, because a word
     * is read and a picture is decoded. The words stay the accessible name
     * throughout.
     */
    compact: { true: { text: 'sr-only 2xl:not-sr-only', icon: '2xl:hidden' } },
    /*
     * `touch` is for a phone's sheet: every segment shares the width and is
     * 44 pixels tall with the well, the smallest target WCAG 2.5.5 accepts.
     */
    size: {
      md: {},
      touch: { root: 'w-full', segment: 'grow basis-0', label: 'h-10 px-4 text-sm' },
    },
  },
  defaultVariants: { size: 'md' },
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
  /** The id of a sentence that says more about the choice, announced with the group. */
  readonly describedBy?: string | undefined
  readonly segments: readonly Segment<Value>[]
  /** The chosen segment, or `undefined` when the value is none of them (a fine-tuned one). */
  readonly value: Value | undefined
  readonly onValueChange: (value: Value) => void
  /** Shows the icons alone until the bar is wide enough for the words. */
  readonly compact?: boolean | undefined
  /** `touch` fills the width at a 44-pixel target, for a phone. */
  readonly size?: 'md' | 'touch' | undefined
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
  describedBy,
  segments,
  value,
  onValueChange,
  compact = false,
  size = 'md',
  className,
}: SegmentedControlProps<Value>) {
  const name = useId()
  const styles = segmentedControl({ compact, size })

  return (
    <fieldset className={styles.root({ className })} aria-describedby={describedBy}>
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
              {segment.icon === undefined ? undefined : (
                <span className={styles.icon()}>{segment.icon}</span>
              )}
              <span className={styles.text()}>{segment.label}</span>
            </label>
          </div>
        )
      })}
    </fieldset>
  )
}
