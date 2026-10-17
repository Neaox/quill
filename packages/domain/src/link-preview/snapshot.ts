import type { LinkPreview, LinkPreviewFailure } from './link-preview.ts'

/**
 * The life of a stored link preview (ADR-042, "Cached as snapshots, never
 * fetched while rendering").
 *
 * A preview is a snapshot of someone else's page, so it is allowed to age and
 * is never fetched while a reader waits. The rules here are the whole of when
 * a stored answer is still good, and when asking again is worth a request to
 * a stranger's server. They are pure so the server, a test and (later) the
 * "as of" label in the UI all read the same ones.
 */

const HOUR = 60 * 60 * 1000

/** A success is current for three days, then served stale while a refresh runs. */
export const PREVIEW_FRESH_FOR_MS = 72 * HOUR

/** A failure is remembered for an hour, which bounds retries against a dead link. */
export const FAILURE_REMEMBERED_FOR_MS = HOUR

/**
 * How long one request for a fetch blocks another. A fetch takes seconds;
 * this is the allowance for it to be lost (a restart, a crash) before the
 * link may be asked for again.
 */
export const REQUEST_IN_FLIGHT_FOR_MS = 5 * 60 * 1000

/** What is stored for one URL, in one scope. */
export type LinkPreviewRecord =
  | { readonly state: 'ready'; readonly preview: LinkPreview; readonly fetchedAt: Date }
  | { readonly state: 'failed'; readonly failure: LinkPreviewFailure; readonly failedAt: Date }
  /** Asked for, nothing known yet. */
  | { readonly state: 'pending'; readonly requestedAt: Date }

/**
 * What a reader is told about one link. It never carries an error to show:
 * every non-ready state means "render the plain link", and the state only says
 * what else the surface may add (a spinner, a retry).
 */
export type LinkPreviewView =
  | { readonly state: 'ready'; readonly preview: LinkPreview; readonly stale: boolean }
  /** A fetch is wanted or running; ask again shortly. */
  | { readonly state: 'pending' }
  /** No preview exists and one is not coming for now. */
  | { readonly state: 'unavailable'; readonly reason: LinkPreviewFailure }
  /** The organisation's policy does not allow it: a plain link, with no retry offered. */
  | { readonly state: 'blocked' }

/** Whether a stored success has outlived its freshness. */
export function isStale(fetchedAt: Date, now: Date): boolean {
  return now.getTime() - fetchedAt.getTime() >= PREVIEW_FRESH_FOR_MS
}

/** When a failure recorded at `failedAt` may be tried again. */
export function retryAfter(failedAt: Date): Date {
  return new Date(failedAt.getTime() + FAILURE_REMEMBERED_FOR_MS)
}
