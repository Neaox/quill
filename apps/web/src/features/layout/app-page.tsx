import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { tv } from '@quill/ui'

import { SignedInHeader } from '../auth/signed-in-header.tsx'
import { SearchField } from '../search/search-field.tsx'
import { SearchProvider } from '../search/search-provider.tsx'
import { useOrganisationName } from '../settings/use-organisation-name.ts'

export const appPageStyles = tv({
  slots: {
    root: 'min-h-dvh bg-background text-foreground',
    // The workspace bar's own treatment (`docs/design/chrome.md`, rule 6): the
    // page colour over a blur with a hairline below, so moving between a
    // workspace and the home page changes nothing about the horizon.
    header: [
      'sticky top-0 z-30 flex h-shell-header items-center gap-2 border-b border-border',
      'bg-background/88 px-4 backdrop-blur-md sm:gap-3',
    ],
    brand: 'min-w-0 truncate text-sm font-semibold tracking-tight text-foreground',
    spacer: 'grow',
    // A 16px gutter on a phone, widening with the window. Every signed-in
    // page outside a workspace is an application surface, not a document, so
    // none of them sits on the reading grid: its start-aligned layout, which
    // an organisation chooses for *reading*, would pin a dashboard to the
    // left edge of a wide window and leave the rest of it empty.
    main: 'px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12',
    content: 'mx-auto flex w-full flex-col gap-8',
  },
  variants: {
    /**
     * How wide the centred column is. `content` is the reading measure and
     * the default, because most of these pages are prose with controls in
     * it. `full` is for a surface with a navigation beside its body or a
     * preview beside a form — the settings screens — and caps at 92rem so a
     * 2560-pixel window still reads as one composition; inside it, prose and
     * fields hold to the measure themselves (`SettingsSection`), and tables,
     * previews and lists take the room.
     */
    width: {
      content: { content: 'max-w-(--layout-content)' },
      full: { content: 'max-w-368' },
    },
  },
  defaultVariants: { width: 'content' },
})

export interface AppPageProps {
  /** The page's own content, in a centred column at the reading measure by default. */
  readonly children: ReactNode
  /** `full` for an application surface that needs more than the reading measure. */
  readonly width?: 'content' | 'full'
  /** Controls that belong to this page, shown before the person menu. */
  readonly actions?: ReactNode | undefined
  /** `false` on the home page itself, which the mark would otherwise link to. */
  readonly brandLinksHome?: boolean
}

/**
 * The frame for a signed-in surface that is not inside a workspace: the home
 * page and the organisation page.
 *
 * It exists because those two had grown their own chrome — the same bar,
 * written twice, at a height neither the document shell nor the other used,
 * and with no way to change the colour scheme even though that is the
 * reader's own setting and follows them everywhere (ADR-028, layer 3). This
 * is that bar once: the product mark, search, the page's actions, and the
 * person menu (which carries the scheme), at `h-shell-header` — the same
 * height the workspace shell's bar is, from the same token — so moving
 * between a workspace and the organisation page does not move the horizon.
 *
 * The workspace shell is deliberately *not* this component: it is a five-area
 * grid with a rail, a tree and a complementary column, and it belongs to
 * `@quill/ui`. This is a page with a bar.
 */
export function AppPage({
  children,
  actions,
  width = 'content',
  brandLinksHome = true,
}: AppPageProps) {
  // The organisation's own name, which `/admin/settings/organisation` is where
  // somebody changes (ADR-034). Not `BRAND.name`: the product is the software,
  // and the bar belongs to whoever is running it.
  const organisationName = useOrganisationName()
  const styles = appPageStyles({ width })

  return (
    // The palette's host, for the home page, which sits outside the
    // authenticated layout route that hosts it everywhere else. On the
    // organisation page, which is inside that layout, this defers to the one
    // already above it rather than opening a second.
    <SearchProvider>
      <div className={styles.root()}>
        <header className={styles.header()}>
          {brandLinksHome ? (
            <Link to="/" className={styles.brand({ className: 'focus-ring rounded-sm' })}>
              {organisationName}
            </Link>
          ) : (
            <span className={styles.brand()}>{organisationName}</span>
          )}
          <span className={styles.spacer()} />
          {/* The same field the workspace shell carries, so search is in the
            same place wherever somebody is signed in. */}
          <SearchField />
          {actions}
          {/* The person menu: their scheme, the organisation's settings when
            they administer it, and signing out (`docs/design/chrome.md`). */}
          <SignedInHeader />
        </header>

        <main className={styles.main()}>
          <div className={styles.content()}>{children}</div>
        </main>
      </div>
    </SearchProvider>
  )
}
