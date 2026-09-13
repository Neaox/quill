import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { BRAND } from '@quill/brand'

import { tv } from '@quill/ui'

import { SignedInHeader } from '../auth/signed-in-header.tsx'
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
    content: 'layout-content flex flex-col gap-8',
  },
})

export interface AppPageProps {
  /** The page's own content, rendered at the reading grid's `content` width. */
  readonly children: ReactNode
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
export function AppPage({ children, actions, brandLinksHome = true }: AppPageProps) {
  const { preference, setPreference } = useThemePreference()
  const styles = appPageStyles()

  return (
    <div className={styles.root()}>
      <header className={styles.header()}>
        {brandLinksHome ? (
          <Link to="/" className={styles.brand({ className: 'focus-ring rounded-sm' })}>
            {BRAND.name}
          </Link>
        ) : (
          <span className={styles.brand()}>{BRAND.name}</span>
        )}
        <span className={styles.spacer()} />
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
  )
}
