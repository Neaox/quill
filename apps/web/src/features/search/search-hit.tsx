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
    <p className={styles.snippet()}>
      {segments.map((segment) =>
        segment.marked ? (
          <mark key={segment.start} className={styles.mark()}>
            {segment.text}
          </mark>
        ) : (
          <span key={segment.start}>{segment.text}</span>
        ),
      )}
    </p>
  )
}

/**
 * One result, as both surfaces show it: the title, the matched words in
 * context, and where the document lives.
 *
 * The breadcrumb is not decoration — a person allowed to see a document is
 * allowed to see where it sits, and a result with no location is a title with
 * nowhere to put it (`docs/architecture/api-contract-m2.md`).
 */
export function SearchHitSummary({ hit }: { readonly hit: SearchHit }) {
  const styles = searchHitStyles()

  return (
    <span className={styles.root()}>
      <span className={styles.title()}>{hit.title}</span>
      <SearchSnippetText hit={hit} />
      <span className={styles.breadcrumb()}>
        {hit.breadcrumb.map((step, index) => (
          <span key={step} className={styles.step()}>
            {index === 0 ? undefined : (
              <span aria-hidden="true" className={styles.separator()}>
                {' / '}
              </span>
            )}
            {step}
          </span>
        ))}
      </span>
    </span>
  )
}
