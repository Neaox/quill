/**
 * Which heading a reader is in, from what an `IntersectionObserver` reports.
 *
 * The observer watches a band across the top of the viewport. A heading is
 * *in* the band while it is crossing it, *above* it once it has gone past, and
 * *below* it before it has arrived. Knowing which side a heading left by is what
 * lets scrolling back up work: when the heading you were in slides down out of
 * the band, nothing is intersecting, and the right answer is the one before it —
 * which only "above" can tell you, and "is it intersecting?" cannot.
 */

export type BandPosition = 'above' | 'in' | 'below'

/** What the observer reports about one heading; the parts of an entry this reads. */
export interface BandEntry {
  readonly isIntersecting: boolean
  readonly boundingClientRect: { readonly top: number }
  /** The band itself, with its margins applied; `null` where the browser cannot say. */
  readonly rootBounds: { readonly top: number } | null
}

export function positionOf(entry: BandEntry): BandPosition {
  if (entry.isIntersecting) return 'in'
  return entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) ? 'above' : 'below'
}

/**
 * The heading to mark as current: the first one in the band, or failing that the
 * last one the reader has passed. Before the first heading has been reached
 * there is none, which is true — nothing has been read yet.
 */
export function activeHeading(
  ids: readonly string[],
  positions: ReadonlyMap<string, BandPosition>,
): string | undefined {
  const inBand = ids.find((id) => positions.get(id) === 'in')
  return inBand ?? ids.findLast((id) => positions.get(id) === 'above')
}
