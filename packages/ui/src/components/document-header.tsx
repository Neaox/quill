import type { ReactNode } from 'react'

import type { ThemeVariants } from '@quill/theme'

import { tv } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent } from '../lib/link.tsx'
import { useThemeVariants } from '../theme/theme-variants.tsx'
import { Breadcrumb, type BreadcrumbItem } from './breadcrumb.tsx'
import { RelativeTime } from './relative-time.tsx'

/**
 * The publication state is a `data-state` attribute on the flag rather than a
 * branch here, so the one place the accent appears in this bar follows the
 * same fact a reader is told in words.
 */
export const documentHeaderStyles = tv({
  slots: {
    /*
     * The page's own colour, nearly opaque, over a blur: the document scrolls
     * up under the bar and stays faintly legible behind it, so the bar reads
     * as part of the page rather than a slab across it. The hairline below is
     * the only edge it needs.
     */
    root: [
      'flex h-shell-header items-center border-b border-border',
      'bg-background/88 backdrop-blur-md',
    ],
    mark: 'flex h-full w-14 shrink-0 items-center justify-center border-e border-border',
    /*
     * On a phone the trail gives way entirely: the bar there holds the
     * controls and nothing else, and the document's own title is the first
     * thing on the page beneath it. A title cut to its first three letters
     * would say less than no title, and still cost the controls their room.
     */
    readout: 'flex min-w-0 items-center gap-1.5 truncate px-4 text-sm text-muted max-sm:hidden',
    trail: 'px-4 max-sm:hidden',
    ancestor: 'hidden lg:contents',
    ancestorLink: [
      'truncate rounded-sm underline decoration-transparent underline-offset-2',
      'transition-[color,text-decoration-color] hover:text-foreground hover:decoration-current',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    separator: 'text-border-strong',
    current: 'truncate font-semibold text-foreground',
    spacer: 'grow',
    // The facts are the first thing to give way as the bar narrows: the
    // complementary column says the same (revisions, signals) on every width
    // where they are hidden here.
    facts: 'hidden items-center gap-3 text-xs whitespace-nowrap text-muted tabular-nums xl:flex',
    fact: 'flex items-center gap-1.5',
    // The date gives way before the state does: the revisions beside the
    // document carry it too, and nothing else on screen says "published".
    revisionFact: 'hidden items-center gap-1.5 2xl:flex',
    /*
     * The state is a word on a quiet pill — the one place in the bar a fact is
     * raised — with the accent kept to the dot, and only when it is published.
     */
    flag: [
      'inline-flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5',
      'font-medium text-foreground-soft',
    ],
    // Published, with or without changes since, is the accent; changes add a
    // ring, so the two differ in shape as well as in words.
    dot: [
      'size-1.5 rounded-full bg-border-strong',
      'data-[state=changed]:bg-accent data-[state=published]:bg-accent',
      'data-[state=changed]:ring-2 data-[state=changed]:ring-accent/30',
    ],
    // On a phone the controls are the whole bar, so they take its width and
    // the first of them (search, normally) can sit at the start of it.
    actions: 'flex items-center gap-1.5 ps-3 pe-4 max-sm:grow max-sm:gap-1 max-sm:ps-2 max-sm:pe-2',
  },
})

/**
 * The publication state of a document: the system's answer to "is this
 * published?", never an author's (ADR-005 amendment). `changed` is published
 * with changes not yet published. The word is the signal, not the dot.
 */
export type DocumentState = 'draft' | 'published' | 'changed' | 'archived'

const STATE_WORDS: Readonly<Record<DocumentState, string>> = {
  draft: 'Draft',
  published: 'Published',
  changed: 'Published, with unpublished changes',
  archived: 'Archived',
}

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
  /** When the document was last changed, as an ISO date or timestamp: said as how long ago, in full on hover. */
  readonly updated?: string | undefined
  readonly owner?: string | undefined
  readonly state?: DocumentState | undefined
}

export interface DocumentHeaderProps {
  readonly status: DocumentStatus
  /**
   * `readout` is Instrument's single line of facts; `breadcrumb` is the trail
   * Press and Atelier use. Both carry the same facts.
   */
  readonly variant?: ThemeVariants['header'] | undefined
  /** The document's controls, at the end of the bar. */
  readonly actions?: ReactNode | undefined
  /** The workspace mark, at the start of the bar. */
  readonly mark?: ReactNode | undefined
  /** Before everything else in the bar: the shell's own control for the tree on a phone. */
  readonly start?: ReactNode | undefined
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
 * Instrument's readout: the path as one line of text, the document in ink and
 * the places above it a tone quieter.
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
 * Instrument reads it as a readout: the path, the state, the revision, and
 * the owner on one quiet line, because they are facts about the document
 * rather than part of it. It is set in the interface face like the rest of the
 * chrome (`docs/design/chrome.md`); the numbers keep tabular figures. Press and Atelier ask for the same
 * facts as a breadcrumb trail with the rest alongside. The variant changes the
 * arrangement; it never changes what is said, so nothing is lost by switching.
 */
export function DocumentHeader({
  status,
  variant,
  actions,
  mark,
  start,
  linkComponent = PlainLink,
  className,
}: DocumentHeaderProps) {
  const variants = useThemeVariants()
  const header = variant ?? variants.header
  const styles = documentHeaderStyles()

  return (
    <header data-header={header} className={styles.root({ className })}>
      {start}
      {mark === undefined ? undefined : <div className={styles.mark()}>{mark}</div>}

      {header === 'readout' ? (
        <Readout status={status} linkComponent={linkComponent} />
      ) : (
        <Breadcrumb items={status.path} linkComponent={linkComponent} className={styles.trail()} />
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
                  {STATE_WORDS[status.state]}
                </span>
              </dd>
            </div>
          )}
          {status.version === undefined && status.updated === undefined ? undefined : (
            <div className={styles.revisionFact()}>
              <dt className="sr-only">Revision</dt>
              <dd>
                {status.version}
                {status.version === undefined || status.updated === undefined ? undefined : ' · '}
                {status.updated === undefined ? undefined : <RelativeTime value={status.updated} />}
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
