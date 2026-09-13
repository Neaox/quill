import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { tv } from '@quill/ui'

import { SignedInHeader } from '../auth/signed-in-header.tsx'
import { SearchField } from '../search/search-field.tsx'
import { SearchProvider } from '../search/search-provider.tsx'
import { useOrganisationName } from '../settings/use-organisation-name.ts'
import { ThemeToggle } from '../theme/theme-toggle.tsx'
import { useThemePreference } from '../theme/use-theme-preference.ts'

export const appPageStyles = tv({
  slots: {
    root: 'min-h-dvh bg-background text-foreground',
    header: [
      'sticky top-0 z-30 flex h-shell-header items-center gap-4 border-b border-border',
      'bg-surface-raised px-4',
    ],
    brand: 'font-semibold tracking-tight',
    spacer: 'grow',
    main: 'layout-grid py-12',
    content: 'flex flex-col gap-8',
  },
  variants: {
    /**
     * Which line of the reading grid the page sits on (ADR-027). `content` is
     * the reading measure and the default, because most of these pages are
     * prose with controls in it. `full` is for a surface that is an
     * application rather than a document — the settings screens, whose theme
     * editor puts a live preview and the doctor's report beside the form, and
     * cannot do that inside a measure meant for a paragraph.
     */
    width: {
      content: { content: 'layout-content' },
      full: { content: 'layout-full' },
    },
  },
  defaultVariants: { width: 'content' },
})

export interface AppPageProps {
  /** The page's own content, on the reading grid's `content` line by default. */
  readonly children: ReactNode
  /** `full` for an application surface that needs more than the reading measure. */
  readonly width?: 'content' | 'full'
  /** Controls that belong to this page, shown before the theme and account controls. */
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
 * is that bar once: the product mark, the page's actions, the theme control,
 * and who is signed in, at `h-shell-header` — the same height the workspace
 * shell's bar is, from the same token — so moving between a workspace and the
 * organisation page does not move the horizon.
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
  const { preference, setPreference } = useThemePreference()
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
          <ThemeToggle
            preference={preference}
            onPreferenceChange={setPreference}
            className="hidden sm:flex"
          />
          <SignedInHeader />
        </header>

        <main className={styles.main()}>
          <div className={styles.content()}>{children}</div>
        </main>
      </div>
    </SearchProvider>
  )
}
