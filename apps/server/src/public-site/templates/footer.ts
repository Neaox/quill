import { html, type Html } from '../html.ts'

/**
 * What closes every public page: when it was last published, and who published
 * it.
 *
 * The date is an absolute `<time datetime>` rather than "three days ago",
 * which is the same rule the rendered body follows (ADR-031): a relative date
 * is a property of now, and a page served from a cache and read by a crawler
 * has no now to be relative to.
 *
 * The organisation's name is a statement of whose documentation this is, and
 * it is the only place a public page names its owner — there is no account
 * menu, no workspace switcher and no "signed in as" here
 * (`docs/product/surfaces.md`).
 */

export interface FooterView {
  readonly organisationName: string
  /** When the page's head revision was published, or null on a page that is not a document. */
  readonly updatedAt: Date | null
}

/** The date, in the form a reader anywhere can read without ambiguity. */
const FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

export function renderFooter(view: FooterView): Html {
  return html`<footer class="site-footer">
    <span>${view.organisationName}</span>
    ${
      view.updatedAt === null
        ? ''
        : html`<span
            >Updated
            <time datetime="${view.updatedAt.toISOString()}"
              >${FORMAT.format(view.updatedAt)}</time
            ></span
          >`
    }
  </footer>`
}
