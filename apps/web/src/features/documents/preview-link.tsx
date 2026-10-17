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

export interface PreviewLinkProps {
  /** The document's id or its readable reference (`slug-shortkey`), as the route has it. */
  readonly documentRef: string
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly className?: string
}

/** The preview's address. Mirrors `readerPreviewHref` in `apps/server/src/routes/reader-preview.ts`. */
export function readerPreviewHref(documentRef: string): string {
  return `/preview/d/${encodeURIComponent(documentRef)}`
}

export function PreviewLink({
  documentRef,
  variant = 'secondary',
  size = 'sm',
  className,
}: PreviewLinkProps) {
  return (
    <a
      href={readerPreviewHref(documentRef)}
      target="_blank"
      rel="noopener"
      title="See this page as readers will"
      className={buttonClassName({ variant, size, className })}
    >
      <PreviewIcon />
      {/* The word gives way to the eye on a phone, as Present and Share do
        beside it, so the document bar fits 375 pixels; the name stays whole. */}
      <span className="max-lg:sr-only">Preview</span>{' '}
      <span className="sr-only">as a reader (opens in a new tab)</span>
    </a>
  )
}
