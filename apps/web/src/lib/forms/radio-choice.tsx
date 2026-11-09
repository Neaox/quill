import { useId, type ReactNode } from 'react'

/**
 * One option of a radio group, with its words beside the control and, under
 * them, what choosing it means: the description is the radio's own
 * `aria-describedby`, so a screen reader reads both, and nothing a person
 * needs is held back for a tooltip.
 *
 * The group is the caller's `fieldset` and `legend`; radios that share a
 * `name` move with the arrow keys, as native radios do.
 */
export interface RadioChoiceProps {
  readonly name: string
  readonly checked: boolean
  readonly label: ReactNode
  readonly description?: ReactNode
  readonly onChange: () => void
}

export function RadioChoice({ name, checked, label, description, onChange }: RadioChoiceProps) {
  const id = useId()
  const descriptionId = `${id}-description`
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="radio"
        name={name}
        className="mt-0.5 size-4 shrink-0 accent-accent"
        checked={checked}
        aria-describedby={description === undefined ? undefined : descriptionId}
        onChange={onChange}
      />
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-sm text-foreground">
          {label}
        </label>
        {description === undefined ? undefined : (
          <span id={descriptionId} className="text-xs text-muted">
            {description}
          </span>
        )}
      </div>
    </div>
  )
}
