import { useId, type ReactNode } from 'react'

import { tv } from '@quill/ui'

export const toggleFieldStyles = tv({
  slots: {
    root: 'flex items-start gap-2.5',
    input: [
      'mt-0.5 size-4 shrink-0 cursor-pointer accent-accent',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'disabled:cursor-not-allowed disabled:opacity-60',
    ],
    text: 'flex flex-col gap-0.5',
    label: 'text-sm font-medium text-foreground',
    description: 'text-xs leading-normal text-muted',
  },
})

export interface ToggleFieldProps {
  readonly label: string
  readonly description?: ReactNode
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly disabled?: boolean
}

/**
 * A policy a tenant turns on or off.
 *
 * A native checkbox, not a styled switch: the state is `:checked` on a real
 * control, so a screen reader, the keyboard, and the style all read the same
 * attribute, and there is no ARIA of our own to get wrong. The sentence under
 * the label says what turning it on lets people do, because a policy named in
 * three words is a policy somebody will read the wrong way round.
 *
 * Three settings screens need this shape — share links, public publishing,
 * and the organisation's layout lock — which is the rule of three that earns
 * a component rather than a fourth copy of the markup (AGENTS.md rule 12).
 */
export function ToggleField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: ToggleFieldProps) {
  const id = useId()
  const descriptionId = `${id}-description`
  const styles = toggleFieldStyles()

  return (
    <div className={styles.root()}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={description === undefined ? undefined : descriptionId}
        onChange={(event) => {
          onCheckedChange(event.target.checked)
        }}
        className={styles.input()}
      />
      <span className={styles.text()}>
        <label htmlFor={id} className={styles.label()}>
          {label}
        </label>
        {description === undefined ? undefined : (
          <span id={descriptionId} className={styles.description()}>
            {description}
          </span>
        )}
      </span>
    </div>
  )
}
