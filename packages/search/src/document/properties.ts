import { compareCodePoints } from '@quill/domain'
import { CoreFrontMatterSchema } from '@quill/markdown'

/**
 * The generic properties of a document (ADR-010, amendment of 2026-10-17): the
 * front-matter keys that are not core fields, as `prop:key=value` can ask
 * about them. Front matter is open by design (ADR-005), so these are whatever
 * authors and templates put there; they are not searchable by default, only
 * explicitly, and a later layer of workspace declarations will map a declared
 * key onto this index rather than build another.
 *
 * Every number below bounds the cost of one document and of one filter, and
 * each is a rule of the index rather than a tuning knob: changing one changes
 * what an existing row holds, so it is a new `IndexableDocument` version.
 */

/** Keys longer than this are dropped, not cut: a key that is not whole matches nothing. */
export const MAX_PROPERTY_KEY_LENGTH = 64
/** Values longer than this are dropped, not cut, for the same reason. */
export const MAX_PROPERTY_VALUE_LENGTH = 200
export const MAX_PROPERTY_VALUES = 20
export const MAX_PROPERTY_KEYS = 30

/** What the index stores for one document: a key and the folded values it holds. */
export type IndexedProperties = Readonly<Record<string, readonly string[]>>

const CORE_FIELDS: ReadonlySet<string> = new Set(Object.keys(CoreFrontMatterSchema.properties))

/**
 * The properties of a document from its whole front matter.
 *
 * - A **core field** (`id`, `title`, `status`, `tags` and the rest of
 *   `CoreFrontMatterSchema`) is never a property; it has its own filter.
 * - A **value** is a string, a finite number or a boolean, or an array of
 *   them; objects, nulls and nested arrays are dropped (inside an array, the
 *   entry is dropped and its scalar neighbours kept).
 * - **Keys and values are folded** to trimmed lower case, numbers and booleans
 *   as their text, and a key or value that is empty after trimming, or longer
 *   than its limit, is dropped. Keys that fold to the same key are merged.
 * - **Bounds**: a value appears once per key; a key keeps its first
 *   {@link MAX_PROPERTY_VALUES} values in written order; a document keeps the
 *   first {@link MAX_PROPERTY_KEYS} keys in code-point order, so which keys
 *   survive does not depend on how the author ordered them.
 */
export function extractProperties(
  frontMatter: Readonly<Record<string, unknown>>,
): IndexedProperties {
  const folded = new Map<string, Set<string>>()
  for (const [rawKey, rawValue] of Object.entries(frontMatter)) {
    if (CORE_FIELDS.has(rawKey)) continue
    const key = rawKey.trim().toLowerCase()
    if (key === '' || key.length > MAX_PROPERTY_KEY_LENGTH) continue

    const values = (Array.isArray(rawValue) ? rawValue : [rawValue]).flatMap(foldScalar)
    if (values.length === 0) continue
    const existing = folded.get(key) ?? new Set<string>()
    for (const value of values) existing.add(value)
    folded.set(key, existing)
  }

  return Object.fromEntries(
    [...folded]
      .toSorted(([left], [right]) => compareCodePoints(left, right))
      .slice(0, MAX_PROPERTY_KEYS)
      .map(([key, values]) => [key, [...values].slice(0, MAX_PROPERTY_VALUES)]),
  )
}

/** One front-matter value as zero or one folded string. */
function foldScalar(value: unknown): readonly string[] {
  const text = scalarText(value)
  if (text === null) return []
  const folded = text.trim().toLowerCase()
  return folded === '' || folded.length > MAX_PROPERTY_VALUE_LENGTH ? [] : [folded]
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}
