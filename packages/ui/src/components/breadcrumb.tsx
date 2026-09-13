import { tv } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent, type LinkTarget } from '../lib/link.tsx'

/**
 * The current step is marked `aria-current="page"`, so that attribute is also
 * what makes it look current: one fact, one place.
 */
export const breadcrumbStyles = tv({
  slots: {
    root: 'min-w-0',
    list: 'flex flex-wrap items-center gap-1.5 text-xs text-muted',
    item: 'flex min-w-0 items-center gap-1.5',
    separator: 'text-border-strong',
    step: 'truncate aria-[current=page]:font-medium aria-[current=page]:text-foreground',
    link: [
      'truncate rounded-sm underline decoration-transparent underline-offset-2',
      'transition-[color,text-decoration-color] hover:text-foreground hover:decoration-current',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
  },
})

export interface BreadcrumbItem {
  readonly label: string
  /**
   * Where the step goes, as a route and its parameters — never a built `href`.
   * Omit on the final item: the page you are on is not a link to itself.
   */
  readonly link?: LinkTarget | undefined
}

export interface BreadcrumbProps {
  readonly items: readonly BreadcrumbItem[]
  readonly label?: string
  /**
   * How a step renders, normally the application's router `Link`. Defaults to
   * `PlainLink`, which is what the design showcase and any consumer with no
   * router get.
   */
  readonly linkComponent?: LinkComponent | undefined
  readonly className?: string | undefined
}

/**
 * The trail from the workspace root to the current document.
 *
 * A labelled navigation landmark containing an ordered list, because the order
 * is the meaning. The last item is marked `aria-current="page"`, and the
 * separators are hidden from the accessibility tree, so a screen reader reads
 * the trail once rather than reading a slash between every step.
 */
export function Breadcrumb({
  items,
  label = 'Breadcrumb',
  linkComponent: Link = PlainLink,
  className,
}: BreadcrumbProps) {
  const styles = breadcrumbStyles()

  return (
    <nav aria-label={label} className={styles.root({ className })}>
      <ol className={styles.list()}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={item.label} className={styles.item()}>
              {index === 0 ? undefined : (
                <span aria-hidden="true" className={styles.separator()}>
                  /
                </span>
              )}
              {isLast || item.link === undefined ? (
                <span className={styles.step()} aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              ) : (
                <Link {...item.link} className={styles.link()}>
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
