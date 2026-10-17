import type { Replacement } from '@quill/application'

import { html, type Html } from '../html.ts'

/**
 * "This page is deprecated." under a public page's byline, with the page
 * that replaces it when the reader may follow it there (ADR-005 amendment,
 * ADR-057).
 *
 * The same markup as `LifecycleNotice` in `@quill/ui`, styled by the one
 * stylesheet both read (`@quill/design-css/byline.css`), so the application,
 * a share link and the public site say it the same way (AGENTS.md rule 16).
 * `replacement` has already been resolved for this surface: a page the
 * reader cannot open is never named (ADR-046). The title is an author's,
 * and the `html` tag escapes it.
 */
export function renderLifecycleNotice(replacement: Replacement | undefined): Html {
  return html`<div
    role="note"
    class="lifecycle-notice"
    data-lifecycle="deprecated"
    aria-label="Deprecated"
  >
    <p class="lifecycle-notice-text">
      <span class="lifecycle-notice-title">This page is deprecated.</span>
      ${
        replacement === undefined
          ? html`It is kept for reference and may be out of date.`
          : html`Use <a href="${replacement.href}">${replacement.title}</a> instead.`
      }
    </p>
  </div>`
}
