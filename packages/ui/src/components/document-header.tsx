import type { ReactNode } from 'react'

import type { ThemeVariants } from '@quill/theme'

import { tv } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent } from '../lib/link.tsx'
import { useThemeVariants } from '../theme/theme-variants.tsx'
import { Breadcrumb, type BreadcrumbItem } from './breadcrumb.tsx'

/**
 * The publication state is a `data-state` attribute on the flag rather than a
 * branch here, so the one place the accent appears in this bar follows the
 * same fact a reader is told in words.
 */
export const documentHeaderStyles = tv({
  slots: {
    root: 'flex h-10 items-center border-b border-border bg-surface-raised',
    mark: 'flex h-10 w-14 shrink-0 items-center justify-center border-e border-border',
    readout: 'meta-value flex min-w-0 items-center gap-1 truncate px-4',
    ancestor: 'hidden sm:contents',
    ancestorLink: [
      'truncate rounded-sm underline decoration-transparent underline-offset-2',
      'transition-[color,text-decoration-color] hover:text-foreground hover:decoration-current',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    separator: 'text-border-strong',
    current: 'truncate font-medium text-foreground',
    spacer: 'grow',
    facts: 'meta-value hidden items-center gap-4 md:flex',
    fact: 'flex items-center gap-1.5',
    flag: 'inline-flex items-center gap-1.5',
    dot: 'size-1.5 rounded-full bg-border-strong data-[state=published]:bg-accent',
    actions: 'flex items-center gap-2 ps-4 pe-3',
  },
})

/** The publication state of a document. The word is the signal, not the dot. */
export type DocumentState = 'draft' | 'in review' | 'published' | 'archived'

/**
 * The facts above a document. Everything but the trail is optional, because
 * the same bar stands above a place that is not a document — a workspace's own
 * home, which has a path and a name and no revision, no state and no owner.
 * A fact that is not known is not shown: the readout never carries a dash
 * standing in for something the platform cannot answer yet.
 */
export interface DocumentStatus {
  /**
   * Workspace to document, root first. The last step is the document itself,
   * which is why it is never a link.
   */
  readonly path: readonly BreadcrumbItem[]
  /** The published revision, as a reader sees it: `v12`. */
  readonly version?: string | undefined
  /** The revision date, as `YYYY-MM-DD`, for a `<time datetime>`. */
  readonly updated?: string | undefined
  readonly owner?: string | undefined
  readonly state?: DocumentState | undefined
}

export interface DocumentHeaderProps {
  readonly status: DocumentStatus
  /**
   * `readout` is Instrument's monospace instrument panel; `breadcrumb` is the
   * trail Press and Atelier use. Both carry the same facts.
   */
  readonly variant?: ThemeVariants['header'] | undefined
  /** The document's controls, at the end of the bar. */
  readonly actions?: ReactNode | undefined
  /** The workspace mark, at the start of the bar. */
  readonly mark?: ReactNode | undefined
  /**
   * How a trail step renders, in both variants: the application's router
   * `Link`. Defaults to `PlainLink`, which is what the design showcase and any
   * consumer with no router get.
   */
  readonly linkComponent?: LinkComponent | undefined
  readonly className?: string | undefined
}

/** Whether anything but the trail is known, and so whether the list is drawn at all. */
function hasFacts(status: DocumentStatus): boolean {
  return (
    status.state !== undefined ||
    status.version !== undefined ||
    status.updated !== undefined ||
    status.owner !== undefined
  )
}

/**
 * Instrument's monospace instrument panel.
 *
 * The ancestors are the same *places* the breadcrumb variant links to, so they
 * are links here too: a header that renders them as inert text would leave the
 * one route back to the workspace working under two identities and dead under
 * the third. A step with no destination — a trail whose root is simply a name
 * — stays plain text.
 */
function Readout({
  status,
  linkComponent: Link,
}: {
  readonly status: DocumentStatus
  readonly linkComponent: LinkComponent
}) {
  const styles = documentHeaderStyles()
  const ancestors = status.path.slice(0, -1)

  return (
    <p className={styles.readout()}>
      {ancestors.map((step) => (
        <span key={step.label} className={styles.ancestor()}>
          {step.link === undefined ? (
            step.label
          ) : (
            <Link {...step.link} className={styles.ancestorLink()}>
              {step.label}
            </Link>
          )}
          <span aria-hidden="true" className={styles.separator()}>
            /
          </span>
        </span>
      ))}
      <span className={styles.current()}>{status.path.at(-1)?.label}</span>
    </p>
  )
}

/**
 * The bar above every document.
 *
 * Instrument reads it as an instrument panel: the path, the state, the
 * revision, and the owner in one monospace line, because they are facts about
 * the document rather than part of it. Press and Atelier ask for the same
 * facts as a breadcrumb trail with the rest alongside. The variant changes the
 * arrangement; it never changes what is said, so nothing is lost by switching.
 */
export function DocumentHeader({
  status,
  variant,
  actions,
  mark,
  linkComponent = PlainLink,
  className,
}: DocumentHeaderProps) {
  const variants = useThemeVariants()
  const header = variant ?? variants.header
  const styles = documentHeaderStyles()

  return (
    <header data-header={header} className={styles.root({ className })}>
      {mark === undefined ? undefined : <div className={styles.mark()}>{mark}</div>}

      {header === 'readout' ? (
        <Readout status={status} linkComponent={linkComponent} />
      ) : (
        <Breadcrumb items={status.path} linkComponent={linkComponent} className="px-4" />
      )}

      <div className={styles.spacer()} />

      {hasFacts(status) ? (
        <dl className={styles.facts()}>
          {status.state === undefined ? undefined : (
            <div className={styles.fact()}>
              <dt className="sr-only">State</dt>
              <dd>
                <span className={styles.flag()}>
                  <span aria-hidden="true" data-state={status.state} className={styles.dot()} />
                  {status.state}
                </span>
              </dd>
            </div>
          )}
          {status.version === undefined && status.updated === undefined ? undefined : (
            <div className={styles.fact()}>
              <dt className="sr-only">Revision</dt>
              <dd>
                {status.version}
                {status.version === undefined || status.updated === undefined ? undefined : ' · '}
                {status.updated === undefined ? undefined : (
                  <time dateTime={status.updated}>{status.updated}</time>
                )}
              </dd>
            </div>
          )}
          {status.owner === undefined ? undefined : (
            <div className={styles.fact()}>
              <dt className="sr-only">Owner</dt>
              <dd>owner: {status.owner}</dd>
            </div>
          )}
        </dl>
      ) : undefined}

      {actions === undefined ? undefined : <div className={styles.actions()}>{actions}</div>}
    </header>
  )
}
