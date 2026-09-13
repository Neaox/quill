/**
 * Commit-message trailers.
 *
 * Trailers are the machine-readable half of a commit message and are what lets
 * the revisions index be rebuilt from the repository alone (ADR-014). A trailer
 * value is a single line: research R4 showed that a folded continuation line
 * makes a backwards trailer parser — git's own included, when it is not asked
 * to unfold — drop the *whole* block, taking the document id with it. Values
 * are therefore folded to one line on write.
 */

export interface Trailer {
  readonly key: string
  readonly value: string
}

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/
const SEPARATOR = ': '

/** Collapse a free-text value onto the single line a trailer allows. */
export function foldTrailerValue(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, ' ').trim()
}

export function formatTrailer(key: string, value: string): string {
  const folded = foldTrailerValue(value)
  // A value-less trailer is written bare, so trailing space cannot be eaten.
  return folded === '' ? `${key}:` : `${key}${SEPARATOR}${folded}`
}

/**
 * The trailer block is the run of `Key: value` lines ending the message. A
 * colon alone is not enough — `See https://example.com` is prose, not a
 * trailer — so the value must be empty or separated by a space.
 */
export function parseTrailers(message: string): Trailer[] {
  const trailers: Trailer[] = []
  for (const line of message.trimEnd().split('\n').toReversed()) {
    const colon = line.indexOf(':')
    const key = line.slice(0, colon)
    const rest = line.slice(colon + 1)
    if (colon === -1 || !KEY_PATTERN.test(key) || !(rest === '' || rest.startsWith(' '))) break
    trailers.push({ key, value: rest.trimStart() })
  }
  return trailers.toReversed()
}

export function trailerValues(trailers: readonly Trailer[], key: string): string[] {
  return trailers.filter((trailer) => trailer.key === key).map((trailer) => trailer.value)
}
