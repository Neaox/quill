import { SearchIcon, tv } from '@quill/ui'

import { preloadSearchDialog, useSearchDialog } from './search-provider.tsx'

export const searchFieldStyles = tv({
  slots: {
    root: [
      'flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5',
      'text-xs text-muted transition-colors ease-standard hover:border-border-strong',
      'hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2',
      'focus-visible:outline-focus-ring',
      // A field on a wide screen, an icon button on a phone: the top bar there
      // has room for the trail and the document's own controls and no more.
      'max-sm:size-8 max-sm:justify-center max-sm:px-0',
      // `min-w-9` is what lets this give way. A flex item's `min-width` is
      // `auto`, which would hold the field at its content's width and make the
      // document's own title the thing that truncates instead — and on a
      // document page the title is the one label in the bar that must survive.
      // Down to the icon's width, the field yields first.
      'min-w-9 shrink',
    ],
    // Deliberately modest, and it grows only where the bar has room to spare:
    // it shares the header with the trail, the document's facts and its
    // controls (`packages/ui/src/components/document-header.tsx`).
    label: 'hidden grow truncate text-start sm:block sm:w-28 lg:w-40 2xl:w-64',
    shortcut: [
      'hidden shrink-0 rounded-xs border border-border-strong bg-surface-raised px-1.5',
      'py-0.5 font-mono text-2xs text-muted sm:inline-block',
    ],
  },
})

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
export function SearchField({ className }: { readonly className?: string | undefined }) {
  const search = useSearchDialog()
  const styles = searchFieldStyles()

  if (search === undefined) return undefined

  return (
    <button
      type="button"
      // Named by the attribute rather than by its contents: the label is
      // hidden at phone widths, where the control is an icon, and a button
      // whose name disappears with the viewport is unusable without sight.
      aria-label="Search documentation"
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
      <span className={styles.label()}>Search documentation</span>
      <kbd className={styles.shortcut()}>{MODIFIER_LABEL}</kbd>
    </button>
  )
}
