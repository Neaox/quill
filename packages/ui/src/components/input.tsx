import { type ComponentPropsWithoutRef, useId } from 'react'

import { tv } from '../lib/class-names.ts'

/**
 * Validity is an attribute, not a branch: `aria-invalid` is what a screen
 * reader reads and what the border colour follows, so the two cannot disagree.
 */
export const inputStyles = tv({
  slots: {
    root: 'flex flex-col gap-1',
    label: 'text-xs font-medium text-foreground',
    required: 'ms-1 text-danger',
    control: [
      'h-8 w-full rounded-md border border-border bg-surface-raised px-2.5 text-xs text-foreground',
      'transition-[border-color,box-shadow] ease-standard placeholder:text-muted/75',
      'hover:border-border-strong',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted',
      'aria-invalid:border-danger aria-invalid:hover:border-danger',
    ],
    description: 'text-2xs leading-normal text-muted',
    error: 'text-2xs leading-normal text-danger',
  },
})

export interface InputProps extends Omit<ComponentPropsWithoutRef<'input'>, 'children'> {
  /** The visible label. Never optional: an unlabelled field is a defect. */
  readonly label: string
  /** Help shown under the field, before it has been used. */
  readonly description?: string
  /** Validation message. Its presence is what marks the field invalid. */
  readonly error?: string
}

/**
 * A labelled text field.
 *
 * The label is always rendered and always associated; description and error
 * are wired into `aria-describedby` in reading order, and the error also marks
 * the control invalid, so the three never drift apart. The error is a live
 * region, so a validation result that appears after submission is announced
 * without moving focus.
 *
 * Help and error sit *below* the control rather than between the label and it.
 * That keeps the label and the control adjacent, so a row of fields in a form
 * grid aligns whether or not each field happens to have help text.
 */
export function Input({
  label,
  description,
  error,
  id,
  className,
  required = false,
  ...rest
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const descriptionId = `${inputId}-description`
  const errorId = `${inputId}-error`
  const styles = inputStyles()

  const describedBy = [
    description === undefined ? undefined : descriptionId,
    error === undefined ? undefined : errorId,
  ]
    .filter((value) => value !== undefined)
    .join(' ')

  return (
    <div className={styles.root({ className })}>
      <label htmlFor={inputId} className={styles.label()}>
        {label}
        {required ? (
          <span className={styles.required()} aria-hidden="true">
            *
          </span>
        ) : undefined}
      </label>

      <input
        id={inputId}
        required={required}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={styles.control()}
        {...rest}
      />

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
