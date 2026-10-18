/** A `prop:` filter read as the key and the value it asks for, both folded as the index folds them. */
export interface PropertyFilter {
  readonly key: string
  readonly value: string
}

/**
 * Reads the value of a `prop:` filter: `key=value`, split at the first `=`
 * (so a value may hold an `=`), both halves trimmed and lower-cased exactly
 * as `extractProperties` folds what it indexes.
 *
 * Null when there is no `=`, or either half is empty. A malformed filter is
 * not a wildcard: every engine answers it with no documents, never with all of
 * them, so one this function cannot read narrows a search to nothing.
 */
export function parsePropertyFilter(text: string): PropertyFilter | null {
  const separator = text.indexOf('=')
  if (separator === -1) return null
  const key = text.slice(0, separator).trim().toLowerCase()
  const value = text
    .slice(separator + 1)
    .trim()
    .toLowerCase()
  return key === '' || value === '' ? null : { key, value }
}
