import type { ReactElement, ReactNode } from 'react'
import { DropdownMenu } from 'radix-ui'

import { CheckIcon } from './icons.tsx'
import { menuStyles } from './menu.tsx'

/**
 * One of a few known values, chosen from a menu opened by the value itself: a
 * document's status, its layout, a template question with a fixed set of
 * answers.
 *
 * The same Radix machinery and look as `Menu` and `MenuButton` — roving focus,
 * type-ahead, Escape, focus returned to the trigger — with the trigger
 * supplied by the caller, because here the trigger *is* the value (a status
 * lozenge in the properties line), and with the menu closing on a choice,
 * because a value was what the person came to change.
 *
 * Each option may lead with a mark (a status's dot); its label always says
 * what it is, so the mark is never the only way to tell options apart.
 */

export interface ChoiceMenuOption {
  readonly value: string
  readonly label: string
  readonly leading?: ReactNode
  /** A line under the label: what the choice means, or why it cannot be made. */
  readonly description?: string | undefined
  /**
   * Offered but not available, with `description` saying why: a choice
   * somebody looks for is disabled rather than hidden (`docs/design/feedback.md`).
   */
  readonly disabled?: boolean | undefined
}

export interface ChoiceMenuProps {
  /**
   * Names the group of choices: "Status". The menu itself is named by its
   * trigger, as Radix wires it, so the trigger's name should say both the
   * property and its value ("Status: Draft").
   */
  readonly label: string
  readonly value: string
  readonly options: readonly ChoiceMenuOption[]
  readonly onValueChange: (value: string) => void
  /** The value as a `button`; it becomes the menu's trigger. */
  readonly trigger: ReactElement
  readonly align?: 'start' | 'end'
  /** Controlled opening, for a caller that opens the menu itself (a property just added). */
  readonly open?: boolean | undefined
  readonly onOpenChange?: ((open: boolean) => void) | undefined
}

export function ChoiceMenu({
  label,
  value,
  options,
  onValueChange,
  trigger,
  align = 'start',
  open,
  onOpenChange,
}: ChoiceMenuProps) {
  const styles = menuStyles({ size: 'md' })

  return (
    <DropdownMenu.Root
      modal={false}
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={styles.content({
            className: options.some((option) => option.description !== undefined) ? 'w-72' : 'w-56',
          })}
        >
          <DropdownMenu.RadioGroup aria-label={label} value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                disabled={option.disabled === true}
                className={styles.item({
                  // A reason has to be legible: the row is quiet rather than faded.
                  className:
                    option.description === undefined
                      ? undefined
                      : 'items-start data-disabled:text-muted data-disabled:opacity-100',
                })}
              >
                {option.leading}
                {option.description === undefined ? (
                  option.label
                ) : (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>{option.label}</span>
                    <span className="text-2xs text-muted">{option.description}</span>
                  </span>
                )}
                <DropdownMenu.ItemIndicator className={styles.indicator()}>
                  <CheckIcon />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
