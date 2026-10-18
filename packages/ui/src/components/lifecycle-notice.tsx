import { cx } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent, type LinkTarget } from '../lib/link.tsx'

/**
 * "This page is deprecated." under a deprecated document's byline, with the
 * page that replaces it when the reader may follow it there (ADR-005
 * amendment, `docs/design/properties.md`).
 *
 * The same markup as the public site's `templates/lifecycle-notice.ts`,
 * styled by the one stylesheet both read (`@quill/design-css/byline.css`), so
 * every surface says it the same way. A note named for what it is, read
 * before the body; its icon is the stylesheet's, and the words carry the
 * meaning.
 */
export interface LifecycleNoticeProps {
  /** The replacement as this reader may follow it; absent, none is named. */
  readonly replacement?: { readonly target: LinkTarget; readonly title: string } | undefined
  readonly linkComponent?: LinkComponent | undefined
  readonly className?: string | undefined
}

export function LifecycleNotice({
  replacement,
  linkComponent: LinkElement = PlainLink,
  className,
}: LifecycleNoticeProps) {
  return (
    <div
      role="note"
      data-lifecycle="deprecated"
      aria-label="Deprecated"
      className={cx('lifecycle-notice', className)}
    >
      <p className="lifecycle-notice-text">
        <span className="lifecycle-notice-title">This page is deprecated.</span>{' '}
        {replacement === undefined ? (
          'It is kept for reference and may be out of date.'
        ) : (
          <>
            Use{' '}
            <LinkElement {...replacement.target} className="">
              {replacement.title}
            </LinkElement>{' '}
            instead.
          </>
        )}
      </p>
    </div>
  )
}
