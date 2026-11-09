import { useRef, useState } from 'react'

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
    // The folded middle: a real button, as large as a thumb needs, reading as the trail does.
    more: [
      'inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-sm px-1 text-muted',
      'cursor-pointer hover:bg-surface hover:text-foreground',
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
  /**
   * Fold the middle of a long trail behind one button, keeping the root, the
   * parent and the page: for a bar or a phone, where a deep trail would cut
   * every step to a few letters or take three lines. The button unfolds the
   * trail in place, so every step stays a link and nothing waits on a hover.
   */
  readonly collapse?: boolean | undefined
  readonly className?: string | undefined
}

/** A trail longer than this folds its middle when asked to. */
const FOLDED_LENGTH = 3

/** A step of a trail as it is drawn: an item, or the button standing for the folded ones. */
export type TrailStep =
  | { readonly kind: 'item'; readonly item: BreadcrumbItem; readonly index: number }
  | { readonly kind: 'more'; readonly hidden: number }

export interface FoldedTrail {
  readonly steps: readonly TrailStep[]
  /** Shows every step; focus goes to the first that was hidden. */
  readonly unfold: () => void
  /** The ref for the element holding the first hidden step, so focus can go there once it shows. */
  readonly firstHidden: (element: HTMLElement | null) => void
}

/**
 * A trail with its middle folded: the root, a button for what is between,
 * the parent and the page. Shared by the breadcrumb and the header's readout,
 * so the two arrangements fold the same steps the same way.
 */
export function useFoldedTrail(items: readonly BreadcrumbItem[], collapse: boolean): FoldedTrail {
  const [unfolded, setUnfolded] = useState(false)
  const first = useRef<HTMLElement | null>(null)
  const all = items.map((item, index): TrailStep => ({ kind: 'item', item, index }))
  const more: TrailStep = { kind: 'more', hidden: items.length - FOLDED_LENGTH }
  const folded = collapse && !unfolded && items.length > FOLDED_LENGTH
  return {
    steps: folded ? [...all.slice(0, 1), more, ...all.slice(-2)] : all,
    firstHidden: (element) => {
      first.current = element
    },
    unfold: () => {
      setUnfolded(true)
      // The steps it hid take its place; focus goes to the first of them.
      requestAnimationFrame(() => {
        first.current?.querySelector('a')?.focus()
      })
    },
  }
}

/** The button a folded trail shows for its middle. */
export function MoreSteps({
  hidden,
  onUnfold,
}: {
  readonly hidden: number
  readonly onUnfold: () => void
}) {
  return (
    <button
      type="button"
      className={breadcrumbStyles().more()}
      aria-expanded={false}
      aria-label={hidden === 1 ? 'Show 1 more step' : `Show ${String(hidden)} more steps`}
      onClick={onUnfold}
    >
      …
    </button>
  )
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
  collapse = false,
  className,
}: BreadcrumbProps) {
  const styles = breadcrumbStyles()
  const { steps, unfold, firstHidden } = useFoldedTrail(items, collapse)

  return (
    <nav aria-label={label} className={styles.root({ className })}>
      <ol className={styles.list()}>
        {steps.map((step, position) => {
          const separator =
            position === 0 ? undefined : (
              <span aria-hidden="true" className={styles.separator()}>
                /
              </span>
            )
          if (step.kind === 'more') {
            return (
              <li key="more" className={styles.item()}>
                {separator}
                <MoreSteps hidden={step.hidden} onUnfold={unfold} />
              </li>
            )
          }
          const { item, index } = step
          const isLast = index === items.length - 1
          return (
            <li
              key={`${String(index)}:${item.label}`}
              ref={index === 1 ? firstHidden : undefined}
              className={styles.item()}
            >
              {separator}
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
