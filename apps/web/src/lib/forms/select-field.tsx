import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react'

import { tv } from '@quill/ui'

/**
 * A labelled `<select>`, in the shape of `@quill/ui`'s `Input`.
 *
 * The design system has no select primitive yet, and three surfaces now need
 * the same one (the collection picker, the template picker, and the revision
 * comparison), which is the rule of three that earns a shared component
 * rather than a fourth copy of the same class string. It lives here beside
 * the other form pieces rather than in `@quill/ui`, because it is a native
 * control in the design system's clothes; the moment a listbox with real
 * options is needed, that is a primitive and this is deleted.
 */
export const selectFieldStyles = tv({
  slots: {
    root: 'flex flex-col gap-1',
    label: 'text-xs font-medium text-foreground',
    control: [
      'h-8 w-full rounded-md border border-border bg-surface-raised px-2 text-xs text-foreground',
      'transition-[border-color] ease-standard hover:border-border-strong',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted',
      'aria-invalid:border-danger',
    ],
    description: 'text-2xs leading-normal text-muted',
  },
})

export interface SelectFieldProps extends Omit<ComponentPropsWithoutRef<'select'>, 'children'> {
  /** The visible label. Never optional: an unlabelled field is a defect. */
  readonly label: string
  readonly description?: string
  readonly children: ReactNode
}

export function SelectField({
  label,
  description,
  id,
  className,
  children,
  ...rest
}: SelectFieldProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const descriptionId = `${selectId}-description`
  const styles = selectFieldStyles()

  return (
    <div className={styles.root({ className })}>
      <label htmlFor={selectId} className={styles.label()}>
        {label}
      </label>
      <select
        id={selectId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        className={styles.control()}
        {...rest}
      >
        {children}
      </select>
      {description === undefined ? undefined : (
        <p id={descriptionId} className={styles.description()}>
          {description}
        </p>
      )}
    </div>
  )
}
