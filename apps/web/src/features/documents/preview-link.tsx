import type { ComponentPropsWithRef } from 'react'

import { buttonClassName, PreviewIcon, type ButtonSize, type ButtonVariant } from '@quill/ui'

/**
 * "Preview as a reader": opens the document as the public site would show it
 * (`GET /preview/d/:documentRef`, `docs/architecture/api-contract-reader-preview.md`).
 *
 * A plain anchor, not a router `Link`: the preview is a page the server
 * renders with the public site's own templates, outside this application, so
 * the browser has to make a real request for it. It opens in a new tab — the
 * member is checking their work, not leaving it — says so to a screen reader,
 * and is `rel="noopener"` so the preview has no handle on the editor's tab.
 * It looks like a button by borrowing the button's classes, the supported way
 * for a link to do that (`buttonClassName`).
 *
 * Offer it wherever a document is read and has a published revision: the
 * preview shows the latest published revision, as readers see it.
 */

/** What the link takes from whatever wraps it: a hover card's handlers and ref, a description. */
type AnchorExtras = Omit<
  ComponentPropsWithRef<'a'>,
  'href' | 'onClick' | 'target' | 'rel' | 'title' | 'className' | 'children'
>

export interface PreviewLinkProps extends AnchorExtras {
  /** The document's id or its readable reference (`slug-shortkey`), as the route has it. */
  readonly documentRef: string
  /** Preview what has been saved and not published, rather than what is published. */
  readonly draft?: boolean
  /**
   * Something to finish before the page it opens is worth looking at: the editor's
   * unsent words must reach the server before a preview of them can show them. The
   * tab is opened at once, inside the click, because a browser allows no more than
   * that; it is sent to the page when this is done.
   */
  readonly beforeOpen?: () => Promise<void>
  /** The tip on hover; `null` for none, where a panel of its own says it. */
  readonly title?: string | null
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly className?: string
}

/** The preview's address. Mirrors `readerPreviewHref` in `apps/server/src/routes/reader-preview.ts`. */
export function readerPreviewHref(documentRef: string): string {
  return `/preview/d/${encodeURIComponent(documentRef)}`
}

/** The preview of the draft: the same page, drawn from what has been saved and not published. */
export function draftPreviewHref(documentRef: string): string {
  return `${readerPreviewHref(documentRef)}?draft`
}

export function PreviewLink({
  documentRef,
  draft = false,
  beforeOpen,
  title = draft ? 'See your unpublished changes as readers will' : 'See this page as readers will',
  variant = 'secondary',
  size = 'sm',
  className,
  ...extras
}: PreviewLinkProps) {
  const href = draft ? draftPreviewHref(documentRef) : readerPreviewHref(documentRef)
  return (
    <a
      {...extras}
      href={href}
      onClick={
        beforeOpen === undefined
          ? undefined
          : (event) => {
              event.preventDefault()
              const tab = window.open('', '_blank')
              // The page opened is the application's own; it has no business with this one.
              if (tab !== null) tab.opener = null
              void beforeOpen().then(() => {
                if (tab === null) window.open(href, '_blank')
                else tab.location.href = href
              })
            }
      }
      target="_blank"
      rel="noopener"
      title={title ?? undefined}
      className={buttonClassName({ variant, size, className })}
    >
      <PreviewIcon />
      {/* The word gives way to the eye on a phone, as Present and Share do
        beside it, so the document bar fits 375 pixels; the name stays whole. */}
      <span className="max-lg:sr-only">Preview</span>{' '}
      <span className="sr-only">
        {draft
          ? 'your unpublished changes (opens in a new tab)'
          : 'as a reader (opens in a new tab)'}
      </span>
    </a>
  )
}
