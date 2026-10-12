import { SearchIcon, tv } from '@quill/ui'

import { preloadSearchDialog, useSearchDialog } from './search-provider.tsx'

export const searchFieldStyles = tv({
  slots: {
    root: [
      'flex items-center text-muted transition-colors ease-standard hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    label: 'grow truncate text-start',
    shortcut: [
      'hidden shrink-0 rounded-sm border border-border bg-surface-raised px-1.5',
      'py-px font-sans text-2xs font-medium text-muted',
    ],
  },
  variants: {
    placement: {
      bar: {
        root: [
          // A well: the page's own groove rather than a boxed field, with an
          // edge only under the pointer.
          'h-8 gap-2 rounded-lg border border-transparent bg-surface px-2.5 text-xs',
          'hover:border-border',
          // A field on a wide screen, an icon button below that: the top bar
          // there has room for the trail and the document's own controls and
          // no more.
          'max-lg:size-8 max-lg:justify-center max-lg:px-0',
          // ...and, on a phone, the first thing in the bar, with the
          // document's own controls gathered at the far end.
          'max-sm:me-auto',
          // `min-w-9` is what lets this give way. A flex item's `min-width` is
          // `auto`, which would hold the field at its content's width and make
          // the document's own title the thing that truncates instead — and
          // on a document page the title is the one label in the bar that
          // must survive. Down to the icon's width, the field yields first.
          'min-w-9 shrink',
        ],
        // Deliberately modest, and it grows only where the bar has room to
        // spare: it shares the header with the trail, the document's facts
        // and its controls (`packages/ui/src/components/document-header.tsx`).
        label: 'hidden lg:block lg:w-20 2xl:w-36',
        shortcut: 'lg:inline-block',
      },
      /**
       * The home page's own search, which is the page's first action rather
       * than a control squeezed into a bar: a raised field the width of the
       * column, with its words at every width.
       */
      page: {
        root: [
          'h-11 w-full gap-3 rounded-lg border border-border bg-surface-raised px-3.5 text-sm',
          'shadow-raised hover:border-border-strong',
        ],
        shortcut: 'sm:inline-block',
      },
    },
  },
  defaultVariants: { placement: 'bar' },
})

/**
 * What each field says and what it is called.
 *
 * The bar's shows one word, which fits beside its shortcut at every width it
 * shows words at, and is named in full; the visible word begins the name, so
 * the two agree (WCAG 2.5.3). The page's says what the palette has become, a
 * way to anywhere as well as a search (`commands.ts`), and is named apart from
 * the bar's so the home page never has two buttons with one name.
 */
const LABELS = {
  bar: { text: 'Search', name: 'Search documentation' },
  page: { text: 'Search or jump to…', name: 'Search or jump to…' },
} as const

/**
 * What the platform's modifier key is called on this machine.
 *
 * A constant, read once when the module is first evaluated: it is a fact about
 * the browser rather than about the application's state, so it is neither
 * state nor something an effect has to keep in step — and the authenticated
 * application is a single-page app (ADR-013), so there is no server render for
 * it to disagree with.
 *
 * `userAgentData.platform` is the question actually being asked, and
 * `navigator.platform` is the older spelling of it; the user-agent string is
 * not consulted, because it is the one vendors are freezing. An unrecognised
 * platform gets `Ctrl`, which is the commoner answer.
 */
function applePlatform(): boolean {
  const hinted: unknown = 'userAgentData' in navigator ? navigator.userAgentData : undefined
  const stated: unknown =
    typeof hinted === 'object' && hinted !== null && 'platform' in hinted
      ? hinted.platform
      : undefined
  const platform = typeof stated === 'string' && stated !== '' ? stated : navigator.platform
  return /mac|iphone|ipad|ipod/i.test(platform)
}

const MODIFIER_LABEL = applePlatform() ? '⌘ K' : 'Ctrl K'

/**
 * The top bar's search field (`docs/design/canvas/Main.dc.html`).
 *
 * A **button**, not an input: what it opens is the palette, whose own field is
 * the one that gets typed into, and a second real text box in the bar would be
 * two places to type the same query into with only one of them working. It
 * says which key opens it, so the shortcut is discoverable rather than folklore.
 *
 * Rendered only where there is a palette to open, so it is never a control
 * that swallows a press (`docs/design/feedback.md`).
 */
export function SearchField({
  className,
  placement = 'bar',
}: {
  readonly className?: string | undefined
  /** `page` for a search that is a page's first action rather than a bar control. */
  readonly placement?: 'bar' | 'page'
}) {
  const search = useSearchDialog()
  const styles = searchFieldStyles({ placement })
  const label = LABELS[placement]

  if (search === undefined) return undefined

  return (
    <button
      type="button"
      // Named by the attribute rather than by its contents: the label is
      // hidden at phone widths, where the control is an icon, and a button
      // whose name disappears with the viewport is unusable without sight.
      aria-label={label.name}
      aria-keyshortcuts="Control+K Meta+K"
      onClick={() => {
        search.setOpen(true)
      }}
      // The same "preload on intent" the router's links use: the palette's
      // chunk is fetched while the pointer is on its way to the click.
      onPointerEnter={preloadSearchDialog}
      onFocus={preloadSearchDialog}
      className={styles.root({ className })}
    >
      <SearchIcon />
      <span className={styles.label()}>{label.text}</span>
      <kbd className={styles.shortcut()}>{MODIFIER_LABEL}</kbd>
    </button>
  )
}
