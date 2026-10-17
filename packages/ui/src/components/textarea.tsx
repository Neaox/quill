import { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react'

import { tv } from '../lib/class-names.ts'
import { inputStyles } from './input.tsx'

/**
 * The multi-line sibling of `Input`: the same label, description and error
 * wiring, the same border and focus ring, and a control that grows with the
 * text it holds instead of scrolling inside a one-line box.
 */
const textareaStyles = tv({
  extend: inputStyles,
  slots: {
    control: 'h-auto min-h-20 resize-y py-1.5 leading-normal',
  },
})

export interface TextareaProps extends Omit<ComponentPropsWithoutRef<'textarea'>, 'children'> {
  /** The visible label. Never optional: an unlabelled field is a defect. */
  readonly label: string
  /** Help shown under the field, before it has been used. */
  readonly description?: ReactNode
  /**
   * What is wrong, as one sentence or a list of them. Its presence marks the
   * field invalid, and it is announced as it appears.
   */
  readonly error?: ReactNode | undefined
}

/**
 * A labelled multi-line text field.
 *
 * As with `Input`, the error is what marks the control invalid, so the border
 * and the accessibility tree cannot disagree, and the description and the
 * error are both in `aria-describedby`, in reading order.
 */
export function Textarea({
  label,
  description,
  error,
  id,
  className,
  rows = 4,
  ...rest
}: TextareaProps) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  const descriptionId = `${textareaId}-description`
  const errorId = `${textareaId}-error`
  const styles = textareaStyles()

  const describedBy = [
    description === undefined ? undefined : descriptionId,
    error === undefined ? undefined : errorId,
  ]
    .filter((value) => value !== undefined)
    .join(' ')

  return (
    <div className={styles.root({ className })}>
      <label htmlFor={textareaId} className={styles.label()}>
        {label}
      </label>

      <textarea
        id={textareaId}
        rows={rows}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={styles.control()}
        {...rest}
      />

      {description === undefined ? undefined : (
        <div id={descriptionId} className={styles.description()}>
          {description}
        </div>
      )}

      {error === undefined ? undefined : (
        <div id={errorId} role="alert" className={styles.error()}>
          {error}
        </div>
      )}
    </div>
  )
}
