import type { ReactNode, RefObject } from 'react'

import { tv } from '../lib/class-names.ts'
import type { LinkComponent, LinkTarget } from '../lib/link.tsx'

/**
 * What a menu is and how it looks, shared by the closed trigger every page
 * draws (`menu.tsx`) and the Radix machinery that opens it, which arrives on
 * demand (`menu-panels.tsx`). A module of its own so neither imports the
 * other.
 *
 * `tokens.css` owns the open and close animation, keyed on Radix's own
 * `data-state`, exactly as the dialog's is.
 */
export const menuStyles = tv({
  slots: {
    // `relative`: the open panel hangs from a box laid over the trigger.
    trigger:
      'relative flex size-7 shrink-0 items-center justify-center px-0 aria-busy:cursor-progress',
    /** The box the panel is positioned against: the trigger's own bounds, inert. */
    anchor: 'pointer-events-none absolute inset-0',
    content: [
      'menu-panel z-50 min-w-40 rounded-md border border-border bg-surface-raised p-1',
      'shadow-raised',
    ],
    item: [
      'flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-start',
      'text-foreground outline-hidden select-none',
      'data-highlighted:bg-surface',
      'data-disabled:pointer-events-none data-disabled:opacity-50',
    ],
    /* The parts only `MenuButton` draws. */
    buttonTrigger: [
      'relative flex h-8 max-w-full min-w-0 shrink-0 items-center gap-2 rounded-md px-1 text-sm',
      'text-foreground-soft transition-colors ease-standard',
      'hover:bg-surface hover:text-foreground',
      'data-[state=open]:bg-surface data-[state=open]:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      // A press that is waiting for the menu to arrive says so.
      'aria-busy:cursor-progress',
    ],
    buttonContent: 'flex min-w-0 items-center gap-2',
    header: 'flex min-w-0 flex-col gap-0.5 px-2.5 pt-2 pb-2',
    groupLabel: 'px-2.5 pt-2 pb-1 text-2xs font-medium text-muted',
    separator: '-mx-1 my-1 h-px bg-border',
    // The accent marks the one chosen option and nothing else in the panel.
    indicator: 'ms-auto text-accent',
  },
  variants: {
    /**
     * `sm` for a row's "⋯" actions, where the panel sits among the tree's
     * small text; `md` for a menu that is a destination in its own right —
     * the person menu in the top bar — and is read like navigation.
     */
    size: {
      sm: { item: 'text-xs' },
      md: { item: 'gap-2 px-2.5 text-sm', content: 'w-64 max-w-[calc(100vw-1rem)]' },
    },
  },
  defaultVariants: { size: 'sm' },
})

export interface MenuItem {
  readonly label: string
  readonly onSelect: () => void
  readonly disabled?: boolean | undefined
}

export interface MenuProps {
  /**
   * What the actions act on. It becomes the trigger's accessible name —
   * "More actions for Failover" — so a screen reader announces which row's
   * menu this is, which three identical "More actions" buttons would not.
   */
  readonly label: string
  readonly items: readonly MenuItem[]
  /** Which edge of the trigger the panel lines up with. */
  readonly align?: 'start' | 'end'
  /** Extra classes for the trigger, for a row that needs a different size. */
  readonly triggerClassName?: string | undefined
  readonly className?: string | undefined
}

/**
 * One row of a `MenuButton`.
 *
 * - `action` runs something here and now (sign out).
 * - `link` goes somewhere, and is rendered as a real anchor through the link
 *   seam, so it can be opened in a new tab and is announced as what it is.
 * - `choice` is a set of mutually exclusive options — the colour scheme —
 *   rendered as `menuitemradio`s with the chosen one checked.
 */
export type MenuEntry =
  | {
      readonly kind: 'action'
      readonly label: string
      readonly onSelect: () => void
      readonly disabled?: boolean | undefined
    }
  | { readonly kind: 'link'; readonly label: string; readonly target: LinkTarget }
  | {
      readonly kind: 'choice'
      /** Names the group of options, for sight and for assistive technology. */
      readonly label: string
      readonly value: string
      readonly options: readonly { readonly value: string; readonly label: string }[]
      readonly onValueChange: (value: string) => void
    }

/** A run of entries with an optional heading; sections are divided by a hairline. */
export interface MenuSection {
  readonly id: string
  readonly label?: string | undefined
  readonly entries: readonly MenuEntry[]
}

export interface MenuButtonProps {
  /**
   * The trigger's accessible name. It must contain the trigger's visible words
   * (WCAG 2.5.3), so a caller whose trigger shows a name says it here too.
   */
  readonly label: string
  /** What the trigger shows. It is hidden from assistive technology, which hears `label`. */
  readonly children: ReactNode
  /** A non-interactive block at the top of the panel, such as who is signed in. */
  readonly header?: ReactNode
  readonly sections: readonly MenuSection[]
  /** How `link` entries are rendered; the application passes its router's. */
  readonly linkComponent?: LinkComponent | undefined
  readonly align?: 'start' | 'end'
  readonly className?: string | undefined
}

/**
 * How a menu was opened: by the keyboard, onto its first item, as a
 * keyboard-opened menu does, or by a pointer, onto the panel.
 */
export type MenuOpening = 'keyboard' | 'pointer'

/**
 * What the on-demand half is given when it attaches to a trigger.
 *
 * The trigger is the light one `menu.tsx` draws, and it stays that element for
 * the menu's whole life: the machinery hangs its panel from it rather than
 * drawing a trigger of its own, so arriving never replaces the node a pointer
 * is over or a key was pressed on (a click that follows a hover in the same
 * moment the module lands still activates).
 */
export interface MenuAnchorProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly opening: MenuOpening | undefined
  /** The light trigger: the panel is labelled by it and gives focus back to it. */
  readonly trigger: RefObject<HTMLButtonElement | null>
  readonly triggerId: string
  readonly contentId: string
}
