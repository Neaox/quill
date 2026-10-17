import { useId, type ReactNode } from 'react'

import { BRAND } from '@quill/brand'
import { tv } from '@quill/ui'

import { BrandLockup } from '../brand/brand-lockup.tsx'
import { ThemeToggle } from '../theme/theme-toggle.tsx'
import { useThemePreference } from '../theme/use-theme-preference.ts'

/**
 * What this instance is, said once beside every signed-out screen. Facts
 * about the product rather than claims, each one something the product does
 * today (publishing, presenting, revisions, the Git-backed content store).
 */
const FACTS: readonly { readonly term: string; readonly detail: string }[] = [
  {
    term: 'Markdown you can keep',
    detail: 'Plain files under version control, never a format only this product reads.',
  },
  {
    term: 'One source, every surface',
    detail: 'The same document reads in the app, on the public web, and on stage.',
  },
  {
    term: 'Every change kept',
    detail: 'Compare any two revisions, or bring an earlier one back.',
  },
]

const authLayout = tv({
  slots: {
    root: 'relative min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-12',
    banner: [
      'absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4',
      'px-5 py-5 sm:px-8 lg:px-12 lg:py-8',
    ],
    statement: [
      'hidden border-e border-border bg-surface',
      'lg:col-span-5 lg:flex lg:flex-col lg:justify-center lg:gap-14 lg:px-12 lg:py-28',
    ],
    intro: 'flex max-w-md flex-col gap-4',
    eyebrow: 'text-2xs font-semibold tracking-caps text-accent uppercase',
    tagline: [
      'font-display text-3xl leading-tight font-semibold tracking-tight text-balance',
      'text-foreground xl:text-4xl',
    ],
    lede: 'max-w-sm text-sm leading-relaxed text-pretty text-muted',
    facts: 'flex max-w-md flex-col divide-y divide-border border-y border-border',
    fact: 'flex flex-col gap-0.5 py-4',
    term: 'text-sm font-medium text-foreground',
    detail: 'text-xs leading-relaxed text-muted',
    main: [
      'flex min-h-dvh justify-center px-5 pt-28 pb-16 sm:px-8 sm:pt-36',
      'lg:col-span-7 lg:items-center lg:px-12 lg:py-28',
    ],
    column: 'w-full max-w-sm',
  },
})

export interface AuthLayoutProps {
  readonly children: ReactNode
}

/**
 * The page every signed-out screen stands on (layout pattern; AGENTS.md rule
 * 16): the product's lockup and the reader's light or dark choice in a banner,
 * a statement of what this instance is, and the one task in `main`.
 *
 * At desktop widths the statement is a quiet surface panel on the leading
 * side and the task sits on the paper beside it, so the form is the only
 * thing on its half of the page. Below the large breakpoint the statement is
 * not drawn at all — on a phone it would push the form below the fold on
 * every visit — and the page is the lockup and the task in one column.
 *
 * Everything is a semantic token: an organisation's identity (ADR-028)
 * recolours and re-sets the whole page without anything here knowing which
 * one is in force.
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  const { preference, setPreference } = useThemePreference()
  const taglineId = useId()
  const styles = authLayout()

  return (
    <div className={styles.root()}>
      <header className={styles.banner()}>
        <BrandLockup size="lg" />
        <ThemeToggle preference={preference} onPreferenceChange={setPreference} />
      </header>

      <aside aria-labelledby={taglineId} className={styles.statement()}>
        <div className={styles.intro()}>
          <p className={styles.eyebrow()}>Team documentation</p>
          <p id={taglineId} className={styles.tagline()}>
            {BRAND.tagline}
          </p>
          <p className={styles.lede()}>
            Write in plain Markdown, read it as a finished page, and publish or present it from the
            same source.
          </p>
        </div>
        <dl className={styles.facts()}>
          {FACTS.map(({ term, detail }) => (
            <div key={term} className={styles.fact()}>
              <dt className={styles.term()}>{term}</dt>
              <dd className={styles.detail()}>{detail}</dd>
            </div>
          ))}
        </dl>
      </aside>

      <main className={styles.main()}>
        <div className={styles.column()}>{children}</div>
      </main>
    </div>
  )
}
