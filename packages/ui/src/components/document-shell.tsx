import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react'
import { flushSync } from 'react-dom'

import type { ThemeVariants } from '@quill/theme'

import { tv } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent } from '../lib/link.tsx'
import { useThemeVariants } from '../theme/theme-variants.tsx'
import { DocumentHeader, type DocumentStatus } from './document-header.tsx'
import { IconRail, type IconRailItem } from './icon-rail.tsx'
import { useNarrowScreen } from '../lib/use-narrow-screen.ts'
import { CloseIcon, SidebarIcon } from './icons.tsx'

/**
 * The shell's areas are in `components.css`, because `grid-template-areas` is
 * the one part of this that has no utility; everything else is here. The
 * `data-rules` attribute the root carries is what the `rules-*` variants
 * elsewhere read, so a theme's rule treatment reaches every descendant without
 * being passed down.
 */
export const documentShellStyles = tv({
  slots: {
    root: 'document-shell text-foreground',
    skip: [
      'sr-only rounded-md bg-surface-raised px-4 py-2 text-sm font-medium text-foreground',
      'shadow-overlay focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50',
    ],
    header: 'shell-header',
    /* On a phone the rail's sections live at the top of the tree's sheet instead. */
    rail: 'shell-rail max-md:hidden',
    /*
     * The sidebar and the complementary column sit straight on the page, as
     * the document does: no panel colour and no rule between them and the
     * text, so the eye reads one page with three columns rather than three
     * boxes. Only where they stack under one another on a narrow screen does a
     * hairline say where one ends.
     */
    /*
     * On a phone the tree is a sheet under the header, behind the "Browse"
     * button, rather than a band pushing the document down: closed, it is not
     * drawn at all; open, it covers the page from the header to the bottom
     * edge and scrolls on its own. `data-state` is the one fact both read.
     */
    nav: [
      'shell-nav w-66 px-2',
      'max-md:fixed max-md:inset-x-0 max-md:top-(--spacing-shell-header) max-md:bottom-0',
      'max-md:z-40 max-md:max-h-none max-md:w-auto max-md:bg-background max-md:px-3',
      'max-md:shadow-overlay max-md:data-[state=closed]:hidden',
    ],
    /** The phone's way to the tree; at the medium breakpoint and up the tree is a column. */
    navToggle: [
      'ms-2 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md',
      'text-muted md:hidden',
      'hover:bg-surface hover:text-foreground aria-expanded:bg-accent-subtle aria-expanded:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    sheetBar: [
      'sticky top-0 z-10 -mx-3 flex items-center justify-between gap-2 border-b border-border',
      'bg-background px-3 py-1.5 md:hidden',
    ],
    sheetTitle: 'section-label',
    /** The rail's sections, as rows at the top of the phone's sheet. */
    sheetSections: 'border-b border-border py-2',
    sheetSection: [
      'flex min-h-10 items-center gap-2.5 rounded-md px-2 text-sm text-foreground-soft',
      'hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
      'aria-[current=page]:bg-accent-subtle aria-[current=page]:font-medium aria-[current=page]:text-foreground',
    ],
    sheetClose: [
      'inline-flex size-10 cursor-pointer items-center justify-center rounded-md text-muted',
      'hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    main: 'shell-main',
    aside: [
      'shell-aside w-60 px-6 pt-8 pb-8',
      'max-lg:w-auto max-lg:border-t max-lg:border-border max-lg:pt-8',
    ],
  },
})

export interface DocumentShellProps {
  readonly status: DocumentStatus
  /** The rail's sections. Rendered as a navigation landmark. */
  readonly railItems: readonly IconRailItem[]
  readonly railCurrentId?: string | undefined
  readonly railFooter?: ReactNode | undefined
  /**
   * How every link the shell itself renders — the rail's sections and the
   * header's trail — is rendered: the application's router `Link`, normally.
   * One seam for the whole frame, so no part of it can be left reloading the
   * page while the rest navigates.
   */
  readonly linkComponent?: LinkComponent | undefined
  /** The document tree, normally a `Tree`. Already a landmark of its own. */
  readonly navigation: ReactNode
  /** Revisions, contents, comments. Complementary to the document. */
  readonly aside?: ReactNode | undefined
  /**
   * A ref to the complementary column itself, for a feature that fills it by
   * rendering into it rather than by passing it down
   * (`apps/web/src/features/workspaces/shell-slots.tsx` explains why that is a
   * portal). A column nothing has been rendered into collapses — `:empty` in
   * `components.css` — so a page with no complement is not framed by an empty
   * bordered strip the width of one.
   */
  readonly asideRef?: Ref<HTMLElement> | undefined
  /** Controls for the document, shown at the end of the header. */
  readonly actions?: ReactNode | undefined
  /** The workspace mark, shown at the start of the header. */
  readonly mark?: ReactNode | undefined
  /** The document itself. */
  readonly children: ReactNode
  /** Overrides for a preview; otherwise the identity in scope decides. */
  readonly headerVariant?: ThemeVariants['header'] | undefined
  readonly rules?: ThemeVariants['rules'] | undefined
  readonly skipLabel?: string | undefined
  readonly className?: string | undefined
}

/**
 * The frame every document is read and edited in.
 *
 * Five landmarks in one order at every width — banner, the rail's navigation,
 * the tree's navigation, main, and the complementary column — so the tab
 * sequence and the visual order agree whether the shell is four columns on a
 * desktop or one on a phone. A skip link comes first, because the rail and the
 * tree are a long way to tab past.
 *
 * The shell owns the arrangement and nothing else: the tree, the aside, and
 * the actions are composed in by the feature, and the theme's signature
 * variants reach them through context rather than through props threaded down
 * by hand.
 */
export function DocumentShell({
  status,
  railItems,
  railCurrentId,
  railFooter,
  linkComponent,
  navigation,
  aside,
  asideRef,
  actions,
  mark,
  children,
  headerVariant,
  rules,
  skipLabel = 'Skip to document',
  className,
}: DocumentShellProps) {
  const variants = useThemeVariants()
  const styles = documentShellStyles()
  const navId = useId()
  const [navOpen, setNavOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const navContainer = useRef<HTMLElement>(null)
  const narrow = useNarrowScreen()
  const SectionLink = linkComponent ?? PlainLink
  // The sheet covers the page only on a narrow screen; there, what is under
  // it is out of reach of the keyboard and assistive technology until it closes.
  const covered = navOpen && narrow

  const openNav = () => {
    flushSync(() => {
      setNavOpen(true)
    })
    // Onto the document being read, so the sheet opens where the reader is.
    const container = navContainer.current
    // The last current item: the rail's section comes first in the sheet, and
    // the document being read is in the tree below it.
    const target =
      [
        ...(container?.querySelectorAll<HTMLElement>('[aria-current="page"]') ??
          /* v8 ignore start -- the section is always mounted: it is the sheet being opened. */
          []),
        /* v8 ignore stop */
      ].at(-1) ?? container?.querySelector<HTMLElement>('a[href], button')
    target?.focus()
  }
  const closeNav = () => {
    setNavOpen(false)
  }

  // While the sheet is open, listens on it — the DOM's events are the external
  // system — for Escape, which closes it and gives focus back to the button,
  // and for a document chosen in it, which is where the reader is going.
  useEffect(() => {
    const container = navContainer.current
    if (!navOpen || container === null) return undefined
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setNavOpen(false)
      toggle.current?.focus()
    }
    const onClick = (event: globalThis.MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href]') !== null) {
        setNavOpen(false)
      }
    }
    container.addEventListener('keydown', onKeyDown)
    container.addEventListener('click', onClick)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      container.removeEventListener('click', onClick)
    }
  }, [navOpen])

  return (
    <div data-rules={rules ?? variants.rules} className={styles.root({ className })}>
      {/*
        `tabIndex` on a link that is already focusable, because Safari and
        every other WebKit browser leave links out of the Tab sequence unless
        "Press Tab to highlight each item on a webpage" is on, and that is off
        by default. An explicit tab index puts the element in the sequential
        order regardless, which is the difference between a skip link that
        works for a Safari keyboard user and one they can never reach. It
        changes nothing in Chromium or Firefox, where a link is tabbable
        already.
      */}
      <a href="#document" tabIndex={0} className={styles.skip()}>
        {skipLabel}
      </a>

      <DocumentHeader
        // The phone's way to the tree, in the bar that stays on screen however
        // far down the document the reader is. At the medium breakpoint and up
        // the tree is a column and this is not drawn.
        start={
          <button
            ref={toggle}
            type="button"
            className={styles.navToggle()}
            aria-expanded={navOpen}
            aria-controls={navId}
            title="Browse documents"
            onClick={() => {
              if (navOpen) closeNav()
              else openNav()
            }}
          >
            <SidebarIcon />
            <span className="sr-only">Browse documents</span>
          </button>
        }
        status={status}
        variant={headerVariant}
        actions={actions}
        mark={mark}
        {...(linkComponent === undefined ? {} : { linkComponent })}
        className={styles.header()}
      />

      {/* A phone has one way in — the sheet — and no band of chrome under the bar. */}
      {narrow ? undefined : (
        <IconRail
          label="Workspace"
          items={railItems}
          currentId={railCurrentId}
          footer={railFooter}
          {...(linkComponent === undefined ? {} : { linkComponent })}
          className={styles.rail()}
        />
      )}

      <section
        ref={navContainer}
        // A region named by the sheet's title, so its bar sits in a landmark.
        aria-labelledby={`${navId}-title`}
        id={navId}
        data-shell-nav=""
        data-state={navOpen ? 'open' : 'closed'}
        className={styles.nav()}
      >
        {/* The sheet's own bar, so it can be closed by touch as well as by Escape. */}
        <div className={styles.sheetBar()}>
          <p id={`${navId}-title`} className={styles.sheetTitle()}>
            Browse
          </p>
          <button
            type="button"
            className={styles.sheetClose()}
            aria-label="Close documents"
            onClick={() => {
              setNavOpen(false)
              toggle.current?.focus()
            }}
          >
            <CloseIcon />
          </button>
        </div>
        {narrow ? (
          <nav aria-label="Workspace" className={styles.sheetSections()}>
            <ul>
              {railItems.map((item) => (
                <li key={item.id}>
                  <SectionLink
                    {...item.link}
                    aria-current={item.id === railCurrentId ? 'page' : undefined}
                    className={styles.sheetSection()}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </SectionLink>
                </li>
              ))}
            </ul>
            {railFooter}
          </nav>
        ) : undefined}
        {navigation}
      </section>

      <main id="document" className={styles.main()} inert={covered}>
        {children}
      </main>

      {aside === undefined && asideRef === undefined ? undefined : (
        <aside ref={asideRef} className={styles.aside()} inert={covered}>
          {aside}
        </aside>
      )}
    </div>
  )
}
