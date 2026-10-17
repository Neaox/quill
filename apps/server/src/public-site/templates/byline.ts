import { lifecycleLabel, type PublicDocumentFacts, type PublicLifecycle } from '@quill/domain'

import { html, type Html } from '../html.ts'

/**
 * The byline under a public page's title: the facts a document states about
 * itself that an outsider may see — its lifecycle (in review, verified and
 * when, deprecated), when it was last reviewed, and its tags (ADR-057,
 * `docs/design/properties.md`). Never its owners, nor who verified it: they
 * are people. A status from before the lifecycle is never shown.
 *
 * The same markup and classes as `DocumentByline` in `@quill/ui`, styled by
 * the one stylesheet both read (`@quill/design-css/byline.css`), so a page
 * looks the same on the public site as it does in the application (AGENTS.md
 * rule 16). Dates are absolute: a cached page has no now to be relative to,
 * which is the rule the footer follows too. Every value is an author's, and
 * the `html` tag escapes each one.
 */

export interface BylineView {
  readonly facts: PublicDocumentFacts
  /** Where a tag's search is, or null on a site with nowhere to search. */
  readonly tagHref: ((tag: string) => string) | null
}

/** The same form as the application's `absoluteDate`: `2 Jan 2026`, in UTC because it is a day. */
const FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** A label's name, as the theme validates it (ADR-037); a tag that could be one carries it. */
const LABEL_NAME = /^[a-z][a-z0-9-]{0,31}$/u

function fact(term: string, value: Html): Html {
  return html`<div class="byline-fact">
    <dt class="byline-term">${term}</dt>
    <dd class="byline-value">${value}</dd>
  </div>`
}

function tag(name: string, href: string | null): Html {
  // Spelled out case by case: an attribute that is there or not, interpolated
  // as a fragment, is the one shape the formatter rewrites with a stray space.
  if (!LABEL_NAME.test(name)) {
    return href === null
      ? html`<span class="byline-tag badge">${name}</span>`
      : html`<a class="byline-tag badge" href="${href}">${name}</a>`
  }
  return href === null
    ? html`<span class="byline-tag badge" data-label="${name}">${name}</span>`
    : html`<a class="byline-tag badge" data-label="${name}" href="${href}">${name}</a>`
}

/** The lifecycle's lozenge, and the day a verification was made when it says. */
function lifecycleValue(lifecycle: PublicLifecycle): Html {
  const lozenge = html`<span data-lifecycle="${lifecycle.state}" class="byline-lifecycle"
    >${lifecycleLabel(lifecycle.state)}</span
  >`
  if (lifecycle.state !== 'verified' || lifecycle.verifiedAt === undefined) return lozenge
  const day = new Date(`${lifecycle.verifiedAt}T00:00:00Z`)
  return html`${lozenge}<span class="byline-verification"
      ><span class="byline-verification-part"
        ><time datetime="${lifecycle.verifiedAt}">${FORMAT.format(day)}</time></span
      ></span
    >`
}

export function renderByline(view: BylineView): Html {
  const { lifecycle, lastReviewed, tags } = view.facts
  const facts: Html[] = []
  if (lifecycle !== undefined) facts.push(fact('Lifecycle', lifecycleValue(lifecycle)))
  if (lastReviewed !== undefined) {
    const day = new Date(`${lastReviewed}T00:00:00Z`)
    facts.push(
      fact(
        'Review',
        html`<span class="byline-review"
          ><span class="byline-review-part"
            ><span
              >Reviewed <time datetime="${lastReviewed}">${FORMAT.format(day)}</time></span
            ></span
          ></span
        >`,
      ),
    )
  }
  if (tags.length > 0) {
    facts.push(
      fact(
        'Tags',
        html`<ul aria-label="Tags" class="byline-list">
          ${tags.map((name) => html`<li>${tag(name, view.tagHref?.(name) ?? null)}</li>`)}
        </ul>`,
      ),
    )
  }
  if (facts.length === 0) return html``
  return html`<div role="group" aria-label="Document properties" class="byline">
    <dl class="byline-facts">${facts}</dl>
  </div>`
}
