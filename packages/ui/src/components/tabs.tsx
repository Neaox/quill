import type { ReactNode } from 'react'
import { Tabs as Primitive } from 'radix-ui'

import { tv } from '../lib/class-names.ts'

/**
 * Radix puts `data-state="active"` on the selected trigger and `disabled` on a
 * disabled one, so both looks follow attributes rather than props.
 */
export const tabsStyles = tv({
  slots: {
    root: 'flex flex-col gap-4',
    list: 'flex',
    tab: [
      'whitespace-nowrap',
      'hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:text-foreground',
    ],
    panel:
      'rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
  },
  variants: {
    /**
     * `underline` is the document's own tabs: small capitals over a rule,
     * the active one underlined in the accent. `segmented` is a settings
     * control's: a few short options in a well, the active one raised out of
     * it, in the interface's sentence case — the look `SegmentedControl` has,
     * for a choice that switches panels rather than sets a value.
     */
    variant: {
      underline: {
        list: 'gap-1 border-b border-border',
        tab: [
          '-mb-px border-b-2 border-transparent px-2.5 pb-2 font-mono text-2xs tracking-caps',
          'text-muted uppercase transition-[color,border-color] ease-standard data-[state=active]:border-accent',
        ],
      },
      segmented: {
        list: 'w-fit max-w-full gap-0.5 rounded-lg bg-surface p-0.5',
        tab: [
          'inline-flex h-7 items-center justify-center rounded-md px-2.5 text-xs font-medium',
          // No transition: the text and the raised surface flip with the
          // scheme together, so neither passes through a colour that leaves
          // the other below contrast while the scheme changes.
          'text-foreground-soft',
          'data-[state=active]:bg-surface-raised data-[state=active]:shadow-raised',
          // The same hairline edge as `SegmentedControl`'s chosen segment, for dark mode.
          'data-[state=active]:ring-1 data-[state=active]:ring-border-strong data-[state=active]:ring-inset',
        ],
      },
    },
    /** `touch` is for a phone: a tab at least 44 pixels tall, the smallest WCAG 2.5.5 accepts. */
    size: {
      md: {},
      touch: {},
    },
  },
  compoundVariants: [
    { variant: 'underline', size: 'touch', class: { tab: 'min-h-11 shrink-0 px-3 pb-0' } },
    {
      variant: 'segmented',
      size: 'touch',
      class: { list: 'w-full', tab: 'h-10 grow basis-0 px-1.5 text-sm' },
    },
  ],
  defaultVariants: { variant: 'underline', size: 'md' },
})

export type TabsVariant = 'underline' | 'segmented'
export type TabsSize = 'md' | 'touch'

export interface TabsProps {
  /** The tab selected on first render, when uncontrolled. */
  readonly defaultValue: string
  readonly value?: string
  readonly onValueChange?: (value: string) => void
  readonly children: ReactNode
  readonly className?: string | undefined
}

/**
 * A tab set: a `TabList` of `Tab`s followed by one `TabPanel` per tab.
 *
 * Arrow keys move between tabs, Home and End jump to the ends, and only the
 * selected tab is in the tab sequence, so Tab moves out of the list and into
 * the panel rather than through every tab. Each panel is labelled by its tab.
 */
export function Tabs({ defaultValue, value, onValueChange, children, className }: TabsProps) {
  return (
    <Primitive.Root
      defaultValue={defaultValue}
      // Forwarded only when supplied: an explicit `undefined` would make the
      // primitive think it is controlled with no value.
      {...(value === undefined ? {} : { value })}
      {...(onValueChange === undefined ? {} : { onValueChange })}
      className={tabsStyles().root({ className })}
    >
      {children}
    </Primitive.Root>
  )
}

export interface TabListProps {
  /** Names the tab list for assistive technology. */
  readonly label: string
  readonly children: ReactNode
  readonly variant?: TabsVariant | undefined
  readonly size?: TabsSize | undefined
  readonly className?: string | undefined
}

/** The row of tabs. Its `variant` and `size` are the ones its tabs are given. */
export function TabList({ label, children, variant, size, className }: TabListProps) {
  return (
    <Primitive.List
      aria-label={label}
      className={tabsStyles({ variant, size }).list({ className })}
    >
      {children}
    </Primitive.List>
  )
}

export interface TabProps {
  readonly value: string
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly variant?: TabsVariant | undefined
  readonly size?: TabsSize | undefined
}

/** A single tab. Must be a child of `TabList`. */
export function Tab({ value, children, disabled = false, variant, size }: TabProps) {
  return (
    <Primitive.Trigger
      value={value}
      disabled={disabled}
      className={tabsStyles({ variant, size }).tab()}
    >
      {children}
    </Primitive.Trigger>
  )
}

export interface TabPanelProps {
  readonly value: string
  readonly children: ReactNode
  readonly className?: string | undefined
}

/** The content for one tab. A sibling of `TabList` inside `Tabs`. */
export function TabPanel({ value, children, className }: TabPanelProps) {
  return (
    <Primitive.Content value={value} className={tabsStyles().panel({ className })}>
      {children}
    </Primitive.Content>
  )
}
