import { Popover } from 'radix-ui'

import type { ThemeVariants } from '@quill/theme'

import { tv } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent, type LinkTarget } from '../lib/link.tsx'
import { useThemeVariants } from '../theme/theme-variants.tsx'
import { buttonClassName } from './button.tsx'
import { CompareIcon, HistoryIcon } from './icons.tsx'
import { RelativeTime } from './relative-time.tsx'

/**
 * The revision on screen is the only tick marked `aria-current`, and that
 * attribute fills its dot with the accent — one fact, announced and painted
 * from the same place. The tick list itself is identical in both variants; the
 * variant decides only whether it is already on screen.
 */
export const revisionTimelineStyles = tv({
  slots: {
    root: '',
    heading: 'section-label pb-2.5',
    list: 'timeline ps-3',
    /*
     * The version is the name, in the middle ink and one weight up; the date
     * is the fact beside it, in the quietest. Tabular figures, so a column of
     * dates lines up without a monospace face.
     */
    link: [
      'group flex min-h-7 items-center gap-2.5 text-xs text-foreground-soft tabular-nums',
      'transition-colors ease-standard hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
      'current:text-foreground',
    ],
    version: 'font-medium',
    date: 'text-muted',
    dot: ['timeline-dot', 'group-current:border-accent group-current:bg-accent'],
    row: 'group/row flex items-center justify-between gap-2',
    compare: [
      'flex size-6 shrink-0 items-center justify-center rounded-sm text-muted opacity-0',
      'transition-[opacity,color] ease-standard hover:bg-surface hover:text-foreground',
      'group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
    ],
    panel: [
      'tooltip-panel z-50 w-60 rounded-lg border border-border bg-surface-raised p-3',
      'shadow-overlay',
    ],
  },
})

export interface Revision {
  readonly id: string
  /** What a reader calls it: `v12`. */
  readonly label: string
  /** When it was published, as an ISO date or timestamp: said as how long ago, in full on hover. */
  readonly at: string
  /** Where the revision is read, as a route and its parameters — never a built `href`. */
  readonly link: LinkTarget
  /**
   * Where this revision is compared with the one before it. Offered beside
   * the tick, quietly until the row is pointed at or focused; absent for the
   * first revision, which has nothing before it.
   */
  readonly compare?: LinkTarget | undefined
}

export interface RevisionTimelineProps {
  readonly label?: string | undefined
  readonly revisions: readonly Revision[]
  /** The revision on screen. The only tick that carries the accent. */
  readonly currentId: string
  /** `timeline` is always visible; `menu` is the same list in a popover. */
  readonly variant?: ThemeVariants['history'] | undefined
  readonly triggerLabel?: string | undefined
  /**
   * How a tick renders: the application's router `Link`, so reading an older
   * revision is a client-side navigation that keeps the shell and the query
   * cache rather than a full page load. Defaults to `PlainLink`, which is what
   * the design showcase and any consumer with no router get.
   */
  readonly linkComponent?: LinkComponent | undefined
  readonly className?: string | undefined
}

function Ticks({
  revisions,
  currentId,
  linkComponent: Link,
}: {
  readonly revisions: readonly Revision[]
  readonly currentId: string
  readonly linkComponent: LinkComponent
}) {
  const styles = revisionTimelineStyles()

  return (
    <ol className={styles.list()}>
      {revisions.map((revision) => {
        const isCurrent = revision.id === currentId
        return (
          <li key={revision.id} className={styles.row()}>
            <Link
              {...revision.link}
              aria-current={isCurrent ? 'true' : undefined}
              className={styles.link()}
            >
              <span aria-hidden="true" className={styles.dot()} />
              <span className={styles.version()}>{revision.label}</span>
              <RelativeTime value={revision.at} className={styles.date()} />
              {isCurrent ? <span className="sr-only">current revision</span> : undefined}
            </Link>
            {revision.compare === undefined ? undefined : (
              <Link
                {...revision.compare}
                className={styles.compare()}
                aria-label={`Compare ${revision.label} with the previous version`}
                title="Compare with previous"
              >
                <CompareIcon />
              </Link>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Every publish, at a glance.
 *
 * An ordered list, because the order is the meaning, and a link per revision,
 * because a revision is a place you can go. The current tick is filled with
 * the accent and also says so, so the state is never carried by colour alone.
 *
 * Instrument keeps the list open down the margin; Press and Atelier ask for
 * the same list behind a control, which is the `menu` variant.
 */
export function RevisionTimeline({
  label = 'Revisions',
  revisions,
  currentId,
  variant,
  triggerLabel = 'History',
  linkComponent = PlainLink,
  className,
}: RevisionTimelineProps) {
  const variants = useThemeVariants()
  const history = variant ?? variants.history
  const styles = revisionTimelineStyles()

  if (history === 'menu') {
    return (
      <Popover.Root>
        <Popover.Trigger
          className={buttonClassName({ variant: 'secondary', size: 'sm', className })}
        >
          <HistoryIcon />
          <span>{triggerLabel}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            aria-label={label}
            className={styles.panel()}
          >
            <p className={styles.heading()}>{label}</p>
            <Ticks revisions={revisions} currentId={currentId} linkComponent={linkComponent} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    )
  }

  return (
    <section aria-label={label} data-history="timeline" className={styles.root({ className })}>
      <p className={styles.heading()}>{label}</p>
      <Ticks revisions={revisions} currentId={currentId} linkComponent={linkComponent} />
    </section>
  )
}
