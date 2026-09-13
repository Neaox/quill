import { Link } from '@tanstack/react-router'
import { useId } from 'react'

import { tv } from '@quill/ui'

import type { SearchHit } from '../../lib/api/index.ts'
import {
  documentLink,
  documentReference,
  type DocumentLinkTarget,
} from '../../lib/routing/document-reference.ts'
import { snippetSegments } from './snippet.ts'

export const searchHitStyles = tv({
  slots: {
    root: 'flex w-full min-w-0 flex-col gap-1',
    title: 'w-full truncate text-sm font-medium text-foreground',
    detail: 'flex w-full min-w-0 flex-col gap-1',
    snippet: 'line-clamp-2 text-xs leading-relaxed text-muted',
    mark: 'rounded-xs bg-accent/15 px-0.5 font-medium text-foreground',
    breadcrumb: 'flex min-w-0 items-center gap-1 text-2xs text-muted',
    step: 'truncate',
    separator: 'text-border-strong',
  },
})

/**
 * Where a hit is read.
 *
 * Built from the document's short key and its title, through the one helper
 * (ADR-035): nothing here concatenates a URL, and the workspace segment comes
 * from the group the hit was offered in — the current workspace's slug for
 * `current`, and the group's own for `elsewhere` — because a hit may well be
 * somewhere else entirely.
 */
export function searchHitLink(workspaceSlug: string, hit: SearchHit): DocumentLinkTarget {
  return documentLink(
    workspaceSlug,
    documentReference({ id: hit.documentId, title: hit.title, shortId: hit.shortId }),
  )
}

/**
 * The snippet, with the matched words marked.
 *
 * `<mark>` from offsets, never HTML from the server (ADR-010): the text is
 * rendered as text by React, so a document that contains angle brackets is
 * shown, not run.
 */
export function SearchSnippetText({ hit }: { readonly hit: SearchHit }) {
  const styles = searchHitStyles()
  const segments = snippetSegments(hit.snippet)

  return (
    // A `<span>`, not a `<p>`: this renders inside a `<button role="option">`
    // in the palette, whose content model is phrasing content, so a paragraph
    // there is invalid markup that would break under server rendering even
    // though React's DOM building hides it today. `line-clamp` sets its own
    // `display`, so nothing is lost.
    <span className={styles.snippet()}>
      {segments.map((segment) =>
        segment.marked ? (
          <mark key={segment.start} className={styles.mark()}>
            {segment.text}
          </mark>
        ) : (
          <span key={segment.start}>{segment.text}</span>
        ),
      )}
    </span>
  )
}

/**
 * Everything about a result *except* its title: the matched words in context,
 * and where the document lives.
 *
 * Kept apart from the title because of what a result is called. A row's
 * accessible name has to be the one phrase that distinguishes it — the title —
 * and this is its description, so a screen reader announces "Regional
 * failover" on arrival and reads the matched text after it, rather than
 * announcing three lines of snippet as the option's name. Both surfaces wire
 * it up that way: the palette through `CommandPaletteOption`'s `label` and
 * `detail`, the results page through `aria-labelledby`/`aria-describedby` on
 * the link.
 *
 * The breadcrumb is not decoration — a person allowed to see a document is
 * allowed to see where it sits, and a result with no location is a title with
 * nowhere to put it (`docs/architecture/api-contract-m2.md`).
 */
export function SearchHitDetail({ hit }: { readonly hit: SearchHit }) {
  const styles = searchHitStyles()
  // A trail is positional — a "Runbooks" collection inside a "Runbooks" unit is
  // a real one — so a step's identity is where it sits, not what it is called.
  const trail = hit.breadcrumb.map((step, index) => ({ step, id: `${index}:${step}` }))

  return (
    <>
      <SearchSnippetText hit={hit} />
      <span className={styles.breadcrumb()}>
        {trail.map(({ step, id }, index) => (
          <span key={id} className={styles.step()}>
            {index === 0 ? undefined : (
              <span aria-hidden="true" className={styles.separator()}>
                {' / '}
              </span>
            )}
            {step}
          </span>
        ))}
      </span>
    </>
  )
}

/**
 * One result on the results page, as a real link.
 *
 * A link, rather than the palette's button, because this is where opening a
 * result in a new tab or copying its address actually matters — and named the
 * same way the palette names its options: the title is the link's accessible
 * name, the snippet and the trail its description, so a screen reader's link
 * list reads as a list of documents rather than of paragraphs.
 */
export function SearchHitLink({
  hit,
  workspaceSlug,
  className,
}: {
  readonly hit: SearchHit
  readonly workspaceSlug: string
  readonly className?: string | undefined
}) {
  const ids = useId()
  const styles = searchHitStyles()

  return (
    <Link
      {...searchHitLink(workspaceSlug, hit)}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-detail`}
      className={className}
    >
      <span className={styles.root()}>
        <span id={`${ids}-title`} className={styles.title()}>
          {hit.title}
        </span>
        <span id={`${ids}-detail`} className={styles.detail()}>
          <SearchHitDetail hit={hit} />
        </span>
      </span>
    </Link>
  )
}
