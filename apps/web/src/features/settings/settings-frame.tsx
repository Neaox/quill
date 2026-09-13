import { Link } from '@tanstack/react-router'
import { createContext, use, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { tv } from '@quill/ui'

import { AppPage } from '../layout/app-page.tsx'
import { SETTINGS_SECTIONS } from './settings-sections.ts'

export const settingsFrameStyles = tv({
  slots: {
    root: 'flex flex-col gap-8 @3xl:flex-row @3xl:gap-12',
    nav: 'shrink-0 @3xl:w-44',
    list: 'flex flex-wrap gap-1 @3xl:flex-col @3xl:flex-nowrap',
    link: [
      'focus-ring block rounded-md px-2.5 py-1.5 text-sm text-muted',
      'transition-colors hover:bg-surface hover:text-foreground',
      'aria-current:bg-surface aria-current:font-medium aria-current:text-foreground',
    ],
    body: 'flex min-w-0 grow flex-col gap-10',
  },
})

/**
 * Where a settings screen puts its own controls.
 *
 * The frame is rendered once by the `/admin/settings` layout route and does
 * not unmount while somebody moves between the four screens, so a screen
 * cannot pass it props. It renders into it instead, through the same portal
 * seam the workspace shell uses for its header actions
 * (`features/workspaces/shell-slots.tsx`): both sides render in the same
 * commit, so switching screens replaces the bar's contents without a frame of
 * emptiness in between.
 */
const SettingsActionsContext = createContext<HTMLElement | null>(null)

export function SettingsActions({ children }: { readonly children: ReactNode }) {
  const container = use(SettingsActionsContext)
  return container === null ? undefined : createPortal(children, container)
}

export interface SettingsFrameProps {
  readonly children: ReactNode
}

/**
 * The frame every instance-settings screen renders inside: the signed-in page
 * bar, and a left navigation listing the four screens.
 *
 * Rendered once, by the `/admin/settings` layout route, so moving between
 * Organisation, Theme, Layout and Secrets keeps the bar and the navigation
 * mounted and only the section changes — the rule in `docs/design/feedback.md`
 * under "moving between pages".
 *
 * The current section is marked with `aria-current="page"` and styled from
 * that attribute, never from a class chosen in JavaScript
 * (`docs/architecture/styling.md`, section 1), so what a screen reader
 * announces and what the eye sees cannot disagree.
 */
export function SettingsFrame({ children }: SettingsFrameProps) {
  // The actions container, held in state and set by a callback ref, so it
  // exists from the first paint and keeps its identity for the life of the
  // settings area.
  const [actionsNode, setActionsNode] = useState<HTMLElement | null>(null)
  const styles = settingsFrameStyles()

  return (
    <AppPage width="full" actions={<span ref={setActionsNode} className="contents" />}>
      <div className="@container">
        <div className={styles.root()}>
          <nav aria-label="Settings" className={styles.nav()}>
            <ul className={styles.list()}>
              {SETTINGS_SECTIONS.map((section) => (
                <li key={section.to}>
                  <Link
                    to={section.to}
                    className={styles.link()}
                    activeProps={{ 'aria-current': 'page' }}
                  >
                    {section.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className={styles.body()}>
            <SettingsActionsContext value={actionsNode}>{children}</SettingsActionsContext>
          </div>
        </div>
      </div>
    </AppPage>
  )
}

export const settingsSectionStyles = tv({
  slots: {
    root: 'flex flex-col gap-4',
    heading: 'text-xl font-semibold tracking-tight text-foreground',
    description: 'mt-1 max-w-(--layout-content) text-sm text-muted',
    body: 'flex flex-col gap-4',
  },
  variants: {
    /**
     * The settings area sits on the grid's `full` line, because the theme
     * editor needs a preview and a report beside a form. A *field* does not:
     * a text input a thousand pixels wide is harder to read than one at the
     * measure, so a section holds its controls to `content` unless it says
     * otherwise.
     */
    wide: {
      true: { body: 'max-w-none' },
      false: { body: 'max-w-(--layout-content)' },
    },
  },
  defaultVariants: { wide: false },
})

export interface SettingsSectionProps {
  readonly title: string
  readonly description?: ReactNode
  readonly children: ReactNode
  /** Headings step down inside a screen that has more than one section. */
  readonly level?: 1 | 2
  /** For a section that is not a form: the theme editor's columns, a table. */
  readonly wide?: boolean
}

/** One titled group of settings, with the sentence that says what it decides. */
export function SettingsSection({
  title,
  description,
  children,
  level = 1,
  wide = false,
}: SettingsSectionProps) {
  const styles = settingsSectionStyles({ wide })
  const Heading = level === 1 ? 'h1' : 'h2'

  return (
    <section className={styles.root()}>
      <div>
        <Heading className={styles.heading()}>{title}</Heading>
        {description === undefined ? undefined : (
          <p className={styles.description()}>{description}</p>
        )}
      </div>
      <div className={styles.body()}>{children}</div>
    </section>
  )
}
