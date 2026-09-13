import type { ReactNode, Ref } from 'react'

import type { ThemeVariants } from '@quill/theme'

import { tv } from '../lib/class-names.ts'
import type { LinkComponent } from '../lib/link.tsx'
import { useThemeVariants } from '../theme/theme-variants.tsx'
import { DocumentHeader, type DocumentStatus } from './document-header.tsx'
import { IconRail, type IconRailItem } from './icon-rail.tsx'

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
    rail: 'shell-rail',
    nav: [
      'shell-nav w-62 border-e border-border bg-surface-raised',
      'max-md:w-auto max-md:border-e-0 max-md:border-b',
    ],
    main: 'shell-main',
    aside: [
      'shell-aside w-56 border-s border-border px-5 py-8',
      'max-lg:w-auto max-lg:border-s-0 max-lg:border-t',
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
        status={status}
        variant={headerVariant}
        actions={actions}
        mark={mark}
        {...(linkComponent === undefined ? {} : { linkComponent })}
        className={styles.header()}
      />

      <IconRail
        label="Workspace"
        items={railItems}
        currentId={railCurrentId}
        footer={railFooter}
        {...(linkComponent === undefined ? {} : { linkComponent })}
        className={styles.rail()}
      />

      <div className={styles.nav()}>{navigation}</div>

      <main id="document" className={styles.main()}>
        {children}
      </main>

      {aside === undefined && asideRef === undefined ? undefined : (
        <aside ref={asideRef} className={styles.aside()}>
          {aside}
        </aside>
      )}
    </div>
  )
}
