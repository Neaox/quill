import { useId, type ReactNode } from 'react'

import { tv } from '@quill/ui'

export const toggleFieldStyles = tv({
  slots: {
    root: 'flex items-start justify-between gap-6',
    input: [
      // The track: a pill in the border's ink when off, the accent when on.
      'relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full',
      'bg-border-strong transition-colors duration-150 checked:bg-accent',
      // The thumb, which slides across; reduced motion keeps the position.
      'before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full',
      'before:bg-surface-raised before:shadow-sm before:transition-transform before:duration-150',
      'checked:before:translate-x-4 motion-reduce:transition-none motion-reduce:before:transition-none',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'disabled:cursor-not-allowed disabled:opacity-50',
    ],
    text: 'flex flex-col gap-0.5',
    heading: 'flex items-center gap-1.5',
    label: 'text-sm font-medium text-foreground',
    description: 'text-xs leading-normal text-muted',
  },
})

export interface ToggleFieldProps {
  readonly label: string
  readonly description?: ReactNode
  /**
   * An explanation of what the setting assumes, beside its label: an
   * `InfoPopover`. The description says what the switch does; this says why.
   */
  readonly help?: ReactNode
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly disabled?: boolean
}

/**
 * A policy a tenant turns on or off, drawn as a switch.
 *
 * Two states, one of which is "on", is a switch rather than a box to tick or
 * a menu of two (`docs/design/feedback.md`). It is still a native checkbox
 * underneath, given `role="switch"`: the state is `:checked` on a real
 * control, so the keyboard (Space), the form, the style and a screen reader
 * all read the same attribute. The role's required `aria-checked` mirrors
 * `checked`, so the two never disagree.
 * The label and its sentence lead and the switch closes the row, as settings
 * read everywhere else. The sentence under
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
  help,
  checked,
  onCheckedChange,
  disabled = false,
}: ToggleFieldProps) {
  const id = useId()
  const descriptionId = `${id}-description`
  const styles = toggleFieldStyles()

  return (
    <div className={styles.root()}>
      <span className={styles.text()}>
        <span className={styles.heading()}>
          <label htmlFor={id} className={styles.label()}>
            {label}
          </label>
          {help}
        </span>
        {description === undefined ? undefined : (
          <span id={descriptionId} className={styles.description()}>
            {description}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        id={id}
        checked={checked}
        aria-checked={checked}
        disabled={disabled}
        aria-describedby={description === undefined ? undefined : descriptionId}
        onChange={(event) => {
          onCheckedChange(event.target.checked)
        }}
        className={styles.input()}
      />
    </div>
  )
}
