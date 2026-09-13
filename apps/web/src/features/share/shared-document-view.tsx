import { tv } from '@quill/ui'

import type { OutlineEntry, SharedNode } from '../../lib/api/index.ts'
import { DocumentBody } from '../documents/document-body.tsx'
import { TableOfContents } from '../documents/table-of-contents.tsx'
import { SharedNavigation } from './shared-navigation.tsx'

/**
 * A document read through a share link.
 *
 * The body is mounted through the **same** `DocumentBody` the signed-in
 * reading view uses, so the reading grid, ADR-027's breakout widths, the
 * scrollable tables, and ADR-030's highlighting are the ones a member sees —
 * one renderer, one set of components, for the app, the share page, and (in
 * turn) the public site (AGENTS.md rule 16). Nothing about the surface is a
 * second implementation of reading; what differs is only what surrounds it.
 *
 * The contents list is mounted **after** the body in tree order, for the
 * reason the reading page states: it subscribes an `IntersectionObserver` to
 * the body's headings, `DocumentBody` puts those headings in the DOM in an
 * effect of its own, and React runs passive effects in tree order. It is also
 * keyed by the revision on screen, so moving to another document in a subtree
 * link rebuilds the subscription rather than leaving it watching nodes that
 * have gone.
 */

const styles = tv({
  slots: {
    layout: 'mx-auto flex w-full max-w-(--layout-max) flex-col gap-8 px-5 py-8 md:flex-row md:px-8',
    main: 'min-w-0 grow',
    aside: 'flex shrink-0 flex-col gap-7 md:sticky md:top-8 md:w-56 md:self-start',
    title: 'text-3xl leading-tight font-semibold tracking-tight text-foreground',
  },
})()

export interface SharedDocumentViewProps {
  readonly token: string
  readonly title: string
  readonly html: string
  readonly revision: string
  readonly outline: readonly OutlineEntry[]
  /** The link's target, which is the first entry of a subtree link's navigation. */
  readonly target: { readonly id: string; readonly title: string; readonly shortId: string }
  /** Empty for a document-scoped link: there is no navigation out of a link's scope. */
  readonly navigation: readonly SharedNode[]
}

export function SharedDocumentView({
  token,
  title,
  html,
  revision,
  outline,
  target,
  navigation,
}: SharedDocumentViewProps) {
  // A document written from a template or by hand opens with its own title as
  // an `h1` in the body. Adding the page's title above it would show it twice
  // and give the page two first-level headings — the reading view's rule,
  // applied to the same bodies.
  const bodyHasTitle = outline[0]?.depth === 1

  return (
    <div className={styles.layout()}>
      <main className={styles.main()}>
        {bodyHasTitle ? undefined : <h1 className={styles.title()}>{title}</h1>}
        <DocumentBody key={revision} html={html} label={title} />
      </main>

      <aside className={styles.aside()}>
        <SharedNavigation token={token} target={target} nodes={navigation} />
        <TableOfContents key={revision} outline={outline} />
      </aside>
    </div>
  )
}
