import { tv } from '@quill/ui'

import type { InvalidQuery, InvalidQueryKind } from '../../lib/api/index.ts'

export const invalidQueryStyles = tv({
  slots: {
    root: 'flex flex-col gap-2',
    reason: 'text-sm text-foreground',
    query: 'overflow-x-auto font-mono text-xs whitespace-pre text-muted',
    at: 'rounded-xs bg-danger/15 px-0.5 text-danger',
    help: 'text-xs leading-relaxed text-muted',
  },
})

/**
 * What each refusal means, in the words somebody typing into a search box
 * would use. The server's own message is accurate and general; this is the
 * same fact said next to the character it happened at.
 *
 * A registry rather than a chain of branches, so the day the query language
 * gains a fourth way to be wrong this is one entry
 * (`docs/architecture/patterns.md`). An unknown kind falls back to the
 * server's message, which is never worse than nothing.
 */
const REASONS: Readonly<Record<InvalidQueryKind, string>> = {
  'unterminated-quote': 'This quotation mark is never closed.',
  'empty-filter-value': 'This filter has nothing after its colon.',
  'nothing-to-search-for':
    'This search only says what to leave out, so there is nothing to look for.',
}

const HELP =
  'Search for words, "an exact phrase", -something to exclude, or a filter such as title:, tag:, owner:, status:, collection: or in:.'

function isKnownKind(kind: string): kind is InvalidQueryKind {
  return Object.hasOwn(REASONS, kind)
}

export interface InvalidQueryNoticeProps {
  /** Exactly what was typed, so the position can be pointed at in it. */
  readonly query: string
  readonly invalid: InvalidQuery
}

/**
 * A query the server would not read, shown where it went wrong.
 *
 * `422 invalid_query` carries the offset it could not get past
 * (`docs/architecture/api-contract-m2.md`), so the query is echoed with that
 * character marked rather than the person being told only that something is
 * wrong. The position is also said in words, because a mark is no use to
 * somebody who cannot see it.
 */
export function InvalidQueryNotice({ query, invalid }: InvalidQueryNoticeProps) {
  const styles = invalidQueryStyles()
  // Typed by the kinds the API documents, so a fourth refusal is a compile
  // error here rather than a silent fall-through; an unknown kind from a newer
  // server still says something, in the server's own words.
  const reason = isKnownKind(invalid.kind) ? REASONS[invalid.kind] : invalid.message
  // A position past the end — a quote that opened at the last character, say
  // — marks nothing rather than an empty span, and the sentence still says
  // where it was.
  const at = Math.max(0, Math.min(invalid.position, query.length))
  const marked = at < query.length

  return (
    <div className={styles.root()}>
      <p role="alert" className={styles.reason()}>
        {reason} {`(at character ${at + 1})`}
      </p>
      <p aria-hidden="true" className={styles.query()}>
        {query.slice(0, at)}
        {marked ? <span className={styles.at()}>{query.slice(at, at + 1)}</span> : undefined}
        {query.slice(at + 1)}
      </p>
      <p className={styles.help()}>{HELP}</p>
    </div>
  )
}
