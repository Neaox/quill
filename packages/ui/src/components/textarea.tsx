import {
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type ReactNode,
  useId,
  useState,
} from 'react'

import { tv } from '../lib/class-names.ts'
import { inputStyles } from './input.tsx'

/**
 * A multi-line field draws on `Input`'s own slots (label, description, error, and the control's
 * border, focus ring and invalid state), so a message box and a text box cannot come to look
 * like two products. Only what is particular to a block of text is added here.
 */
export const textareaStyles = tv({
  slots: {
    control: 'h-auto min-h-20 resize-y py-2 leading-relaxed',
    footer: 'flex items-start justify-between gap-3',
    remaining: 'ms-auto shrink-0 text-2xs text-muted tabular-nums',
  },
})

export interface TextareaProps extends Omit<ComponentPropsWithoutRef<'textarea'>, 'children'> {
  /** The visible label. Never optional, as on `Input`. */
  readonly label: string
  /** Help shown under the field. */
  readonly description?: ReactNode
  /** Validation message, one sentence or a list of them. Its presence is what marks the field invalid. */
  readonly error?: ReactNode | undefined
}

/**
 * A labelled multi-line field, with the characters left when it has a `maxLength`.
 *
 * The count is a convenience and never the only signal: the limit itself is the browser's
 * `maxLength`, which stops the typing, and the number is read out by nothing (it changes on
 * every key, which a live region would turn into noise).
 */
export function Textarea({
  label,
  description,
  error,
  id,
  className,
  maxLength,
  defaultValue,
  value,
  onChange,
  required = false,
  ...rest
}: TextareaProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = `${fieldId}-description`
  const errorId = `${fieldId}-error`
  const field = inputStyles()
  const own = textareaStyles()
  const [typed, setTyped] = useState(String(defaultValue ?? ''))
  const length = value === undefined ? typed.length : String(value).length

  const describedBy = [
    description === undefined ? undefined : descriptionId,
    error === undefined ? undefined : errorId,
  ]
    .filter((part) => part !== undefined)
    .join(' ')

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setTyped(event.target.value)
    onChange?.(event)
  }

  return (
    <div className={field.root({ className })}>
      <label htmlFor={fieldId} className={field.label()}>
        {label}
        {required ? (
          <span className={field.required()} aria-hidden="true">
            *
          </span>
        ) : undefined}
      </label>

      <textarea
        id={fieldId}
        required={required}
        maxLength={maxLength}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={field.control({ className: own.control() })}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        {...rest}
      />

      <div className={own.footer()}>
        <div className="flex min-w-0 flex-col gap-1">
          {description === undefined ? undefined : (
            <p id={descriptionId} className={field.description()}>
              {description}
            </p>
          )}
          {error === undefined ? undefined : (
            <p id={errorId} role="alert" className={field.error()}>
              {error}
            </p>
          )}
        </div>
        {maxLength === undefined ? undefined : (
          <span aria-hidden="true" className={own.remaining()}>
            {maxLength - length} left
          </span>
        )}
      </div>
    </div>
  )
}
