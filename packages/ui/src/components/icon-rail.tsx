import type { ReactNode } from 'react'

import { tv } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent, type LinkTarget } from '../lib/link.tsx'

/**
 * The current section is marked `aria-current="page"`, and that attribute is
 * what inverts it: the state is announced and painted from one fact, so it
 * survives monochrome and cannot drift out of step with the markup.
 */
export const iconRailStyles = tv({
  slots: {
    root: [
      'flex flex-col items-center gap-1.5 bg-surface-raised p-2 border-e border-border',
      'max-md:flex-row max-md:border-e-0 max-md:border-b',
    ],
    list: 'flex flex-col items-center gap-1.5 max-md:flex-row',
    link: [
      'inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted',
      'transition-[color,background-color] ease-standard',
      'hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      'aria-[current=page]:bg-foreground aria-[current=page]:text-background',
    ],
    footer: 'mt-auto pb-1 max-md:mt-0 max-md:ms-auto max-md:pb-0',
  },
})

export interface IconRailItem {
  readonly id: string
  /** The accessible name. The icon is decorative; this is what is announced. */
  readonly label: string
  readonly icon: ReactNode
  /** Where the section is, as a route and its parameters — never a built `href`. */
  readonly link: LinkTarget
}

export interface IconRailProps {
  /** Names the navigation landmark. */
  readonly label: string
  readonly items: readonly IconRailItem[]
  readonly currentId?: string | undefined
  /** The account control, pinned to the far end. */
  readonly footer?: ReactNode | undefined
  /**
   * How a rail item renders: the application's router `Link` (client-side
   * navigation, preload on intent), so pressing one keeps the shell it is part
   * of rather than reloading the whole application. Defaults to `PlainLink`,
   * which is what the design showcase and any consumer with no router get.
   */
  readonly linkComponent?: LinkComponent | undefined
  readonly className?: string | undefined
}

/**
 * The rail of workspace sections.
 *
 * Icons alone would leave the meaning in the picture, so every control carries
 * its label as its accessible name and as a native tooltip. Forty-pixel
 * targets, the artboard's size, comfortably clear the WCAG 2.2 target-size
 * floor.
 */
export function IconRail({
  label,
  items,
  currentId,
  footer,
  linkComponent: Link = PlainLink,
  className,
}: IconRailProps) {
  const styles = iconRailStyles()

  return (
    <nav aria-label={label} className={styles.root({ className })}>
      <ul className={styles.list()}>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              {...item.link}
              aria-label={item.label}
              aria-current={item.id === currentId ? 'page' : undefined}
              title={item.label}
              className={styles.link()}
            >
              {item.icon}
            </Link>
          </li>
        ))}
      </ul>
      {footer === undefined ? undefined : <div className={styles.footer()}>{footer}</div>}
    </nav>
  )
}
