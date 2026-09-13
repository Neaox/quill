import { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react'

import { tv } from '../lib/class-names.ts'
import { inputStyles } from './input.tsx'

/**
 * The two fields a properties surface needs that `Input` is not.
 *
 * A document's properties are a small form of mixed kinds — free text, a
 * choice, and facts that are shown but written elsewhere — and a form only
 * reads as one form if every row is built the same way. Both of these take
 * their label, control, help, and error slots from `inputStyles`, so a select
 * and a text field on the same row are the same height, the same face, and
 * carry the same focus ring; changing the field look changes all three.
 */

export const propertySelectStyles = tv({
  extend: inputStyles,
  slots: {
    /* A native select is the control a keyboard, a screen reader, and a phone
       all already know. The chevron is drawn beside it rather than by the
       platform, so it follows the theme's muted colour like every other glyph. */
    control: 'appearance-none pe-7',
    field: 'relative flex items-center',
    chevron: 'pointer-events-none absolute end-2 size-3.5 text-muted',
  },
})

export interface PropertySelectOption {
  readonly value: string
  readonly label: string
}

export interface PropertySelectProps extends Omit<
  ComponentPropsWithoutRef<'select'>,
  'children' | 'value' | 'defaultValue'
> {
  /** The visible label. Never optional: an unlabelled field is a defect. */
  readonly label: string
  readonly value: string
  readonly options: readonly PropertySelectOption[]
  readonly description?: string | undefined
  readonly error?: string | undefined
}

export function PropertySelect({
  label,
  value,
  options,
  description,
  error,
  id,
  className,
  ...rest
}: PropertySelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const descriptionId = `${selectId}-description`
  const errorId = `${selectId}-error`
  const styles = propertySelectStyles()

  const describedBy = [
    description === undefined ? undefined : descriptionId,
    error === undefined ? undefined : errorId,
  ]
    .filter((entry) => entry !== undefined)
    .join(' ')

  return (
    <div className={styles.root({ className })}>
      <label htmlFor={selectId} className={styles.label()}>
        {label}
      </label>

      <span className={styles.field()}>
        <select
          id={selectId}
          value={value}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          className={styles.control()}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className={styles.chevron()}
        >
          <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
        </svg>
      </span>

      {description === undefined ? undefined : (
        <p id={descriptionId} className={styles.description()}>
          {description}
        </p>
      )}

      {error === undefined ? undefined : (
        <p id={errorId} role="alert" className={styles.error()}>
          {error}
        </p>
      )}
    </div>
  )
}

export const propertyReadoutStyles = tv({
  extend: inputStyles,
  slots: {
    /* The same box as a control, without the affordances of one: no border to
       invite a click, and the value set in the mono face because it is a fact
       about the document rather than something being typed. */
    control:
      'meta-value flex h-8 w-full items-center truncate rounded-md border border-transparent bg-surface px-2.5 text-foreground',
  },
})

export interface PropertyReadoutProps {
  readonly label: string
  readonly children: ReactNode
  readonly description?: string | undefined
  readonly className?: string | undefined
}

/**
 * A property the document decides and this surface only reports — the title,
 * which is the document's own first heading. It is a description list of one
 * so that the label and the value are associated for a screen reader without
 * pretending to be a control nobody can use.
 */
export function PropertyReadout({ label, children, description, className }: PropertyReadoutProps) {
  const styles = propertyReadoutStyles()
  return (
    <dl className={styles.root({ className })}>
      <dt className={styles.label()}>{label}</dt>
      <dd className={styles.control()}>{children}</dd>
      {description === undefined ? undefined : (
        <dd className={styles.description()}>{description}</dd>
      )}
    </dl>
  )
}
