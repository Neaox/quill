import { html, type Html } from '../html.ts'

/**
 * The one thing that tells a member they are looking at a preview rather than
 * the public site (`GET /preview/d/:documentRef`).
 *
 * A slim pill fixed to the bottom of the window, so the page above it is laid
 * out exactly as a reader's would be — a bar pushing the header down would be
 * previewing a different page. It is an `aside` with a label, early in the
 * source so a screen reader meets it before the page, and its close control
 * is a link back to the document in the application: closing a preview *is*
 * going back, and a link is what goes somewhere (AGENTS.md rule 14).
 */

export interface PreviewBannerView {
  /** The document in the application. */
  readonly closeHref: string
  /** Where an anonymous reader finds the page today, or null when it is not on the web. */
  readonly publicHref: string | null
}

const CLOSE_ICON = html`<svg
  viewBox="0 0 16 16"
  width="14"
  height="14"
  aria-hidden="true"
  focusable="false"
>
  <path
    d="M4 4l8 8M12 4l-8 8"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
  />
</svg>`

export function renderPreviewBanner(view: PreviewBannerView): Html {
  return html`<aside class="site-preview" aria-label="Reader preview">
    <span class="site-preview-badge">Preview</span>
    <span class="site-preview-status">
      ${
        view.publicHref === null
          ? html`Not on the public web`
          : html`Live on the web · <a href="${view.publicHref}">View the live page</a>`
      }
    </span>
    <a class="site-preview-close" href="${view.closeHref}" title="Close preview"
      >${CLOSE_ICON}<span class="visually-hidden">Close preview</span></a
    >
  </aside>`
}
