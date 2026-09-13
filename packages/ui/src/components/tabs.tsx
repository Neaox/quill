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
    list: 'flex gap-1 border-b border-border',
    tab: [
      '-mb-px border-b-2 border-transparent px-2.5 pb-2 font-mono text-2xs tracking-caps',
      'text-muted uppercase transition-[color,border-color] ease-standard',
      'hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:border-accent data-[state=active]:text-foreground',
    ],
    panel:
      'rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
  },
})

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
  readonly className?: string | undefined
}

/** The row of tabs. */
export function TabList({ label, children, className }: TabListProps) {
  return (
    <Primitive.List aria-label={label} className={tabsStyles().list({ className })}>
      {children}
    </Primitive.List>
  )
}

export interface TabProps {
  readonly value: string
  readonly children: ReactNode
  readonly disabled?: boolean
}

/** A single tab. Must be a child of `TabList`. */
export function Tab({ value, children, disabled = false }: TabProps) {
  return (
    <Primitive.Trigger value={value} disabled={disabled} className={tabsStyles().tab()}>
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
