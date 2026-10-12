import { useId } from 'react'
import { DropdownMenu } from 'radix-ui'

import { tv } from '../lib/class-names.ts'
import { CheckIcon, ChevronDownIcon } from './icons.tsx'
import { formatMoment, toMoment } from '../lib/time/moment.ts'
import { LocalTime } from './local-time.tsx'
import { RelativeTime } from './relative-time.tsx'

/**
 * Choosing one version of a document: one end of a comparison.
 *
 * The ARIA menu button with a group of radio items — the pattern a choice
 * from a short list in a toolbar is — through Radix's `DropdownMenu`, so the
 * keyboard model is the menu's: arrows, Home and End, type-ahead on the
 * version's name, Escape, and focus back on the trigger. Each row reads like
 * a tick of the revision timeline (`revision-timeline.tsx`): the version, a
 * tag for the one that is current or a draft, the date, and who published it
 * and why.
 *
 * The trigger shows the side ("From") above the version it is set to, so a
 * pair of pickers reads as a sentence; its accessible name says the same in
 * words, and its visible content is hidden from assistive technology so the
 * two are never read twice.
 */
export const revisionPickerStyles = tv({
  slots: {
    trigger: [
      'group inline-flex h-10 min-w-0 items-center gap-2.5 rounded-md border border-border',
      'bg-surface-raised ps-3 pe-2 text-start text-sm text-foreground shadow-xs',
      'transition-colors ease-standard hover:border-border-strong',
      'data-[state=open]:border-border-strong data-[state=open]:bg-surface',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    triggerText: 'flex min-w-0 flex-col leading-tight',
    side: 'text-2xs font-medium tracking-caps text-muted uppercase',
    value: 'flex min-w-0 items-baseline gap-1.5 truncate font-medium tabular-nums',
    valueDate: 'font-normal text-muted',
    chevron: 'ms-auto text-muted transition-transform group-data-[state=open]:rotate-180',
    content: [
      'menu-panel z-50 flex max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))]',
      'w-80 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto rounded-lg border border-border',
      'bg-surface-raised p-1.5 shadow-raised',
    ],
    heading: 'px-2.5 pt-1.5 pb-2 text-2xs font-medium tracking-caps text-muted uppercase',
    list: 'flex flex-col',
    item: [
      'relative grid cursor-pointer grid-cols-[0.75rem_1fr_auto] gap-x-2.5 rounded-md py-2 ps-2.5 pe-2.5',
      'text-start outline-hidden select-none',
      'data-highlighted:bg-surface data-[state=checked]:bg-accent-subtle/60',
      'data-disabled:cursor-not-allowed data-disabled:opacity-50',
    ],
    dot: [
      'mt-1.5 size-2 rounded-full border border-border-strong bg-surface-raised',
      'group-data-[state=checked]/item:border-accent group-data-[state=checked]/item:bg-accent',
    ],
    body: 'flex min-w-0 flex-col gap-0.5',
    title: 'flex min-w-0 items-baseline gap-2 text-sm font-medium text-foreground tabular-nums',
    tag: [
      'rounded-sm bg-surface px-1.5 py-px text-2xs font-medium text-foreground-soft',
      'data-[tag=Draft]:bg-warning-subtle data-[tag=Latest]:bg-accent-subtle',
    ],
    date: 'text-xs font-normal text-muted',
    detail: 'truncate text-xs text-muted',
    indicator: 'mt-0.5 text-accent',
  },
})

export interface RevisionChoice {
  readonly id: string
  /** What a reader calls it: `v12`, or "Your draft". */
  readonly label: string
  /** When it was published, as an ISO date or timestamp; absent for a draft, which has no publish date. */
  readonly at?: string | undefined
  readonly author?: string | undefined
  /** The change note it was published with. */
  readonly note?: string | undefined
  /** A word set beside the label: "Latest", "Draft". */
  readonly tag?: string | undefined
  /** Shown, and not choosable: the other end of the comparison. */
  readonly disabled?: boolean | undefined
}

export interface RevisionPickerProps {
  /** Which end this is — "From", "To" — and the menu's name. */
  readonly label: string
  readonly value: string
  readonly choices: readonly RevisionChoice[]
  readonly onValueChange: (id: string) => void
  readonly align?: 'start' | 'end' | undefined
  readonly className?: string | undefined
}

function spoken(choice: RevisionChoice | undefined): string {
  if (choice === undefined) return 'none'
  const at = choice.at === undefined ? undefined : toMoment(choice.at)
  return at === undefined ? choice.label : `${choice.label}, ${formatMoment(at, 'date')}`
}

export function RevisionPicker({
  label,
  value,
  choices,
  onValueChange,
  align = 'start',
  className,
}: RevisionPickerProps) {
  const styles = revisionPickerStyles()
  const headingId = useId()
  const current = choices.find((choice) => choice.id === value)

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className={styles.trigger({ className })}>
        <span className="sr-only">{`${label}: ${spoken(current)}`}</span>
        <span aria-hidden="true" className={styles.triggerText()}>
          <span className={styles.side()}>{label}</span>
          <span className={styles.value()}>
            {current?.label ?? 'Choose a version'}
            {current?.at === undefined ? undefined : (
              <LocalTime value={current.at} className={styles.valueDate()} />
            )}
          </span>
        </span>
        <ChevronDownIcon className={styles.chevron()} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          aria-labelledby={headingId}
          // Open on the version already chosen, as a select does, so the
          // arrows move from where the person is rather than from the top.
          onOpenAutoFocus={(event) => {
            const content = event.currentTarget
            const checked =
              content instanceof HTMLElement
                ? content.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
                : null
            if (checked === null) return
            event.preventDefault()
            checked.focus()
          }}
          className={styles.content()}
        >
          <DropdownMenu.Label id={headingId} className={styles.heading()}>
            {label}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={onValueChange}
            className={styles.list()}
          >
            {choices.map((choice) => (
              <DropdownMenu.RadioItem
                key={choice.id}
                value={choice.id}
                textValue={choice.label}
                disabled={choice.disabled === true}
                className={styles.item({ className: 'group/item' })}
              >
                <span aria-hidden="true" className={styles.dot()} />
                <span className={styles.body()}>
                  <span className={styles.title()}>
                    {choice.label}
                    {choice.tag === undefined ? undefined : (
                      <span data-tag={choice.tag} className={styles.tag()}>
                        {choice.tag}
                      </span>
                    )}
                    {choice.at === undefined ? undefined : (
                      <RelativeTime value={choice.at} className={styles.date()} />
                    )}
                  </span>
                  {choice.author === undefined && choice.note === undefined ? undefined : (
                    <span className={styles.detail()}>
                      {[choice.author, choice.note]
                        .filter((part) => part !== undefined)
                        .join(' · ')}
                    </span>
                  )}
                </span>
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
