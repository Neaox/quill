/**
 * Transport form of `TokenRange[]`: a compact, versioned string safe to sit
 * in an HTML attribute (`data-tokens`) unescaped — only `[0-9a-z,:;]` ever
 * appear.
 *
 * `TOKEN_CLASSES` is the shared type table both directions read, so a packed
 * payload carries an index into it rather than a class name; nothing here
 * repeats that table per payload.
 */
import { TOKEN_CLASSES, type TokenClass, type TokenRange } from './tokens.ts'

/**
 * The version written into every payload. ADR-033 makes a persisted format's
 * reader dispatch on its version, so this is the one writers emit and
 * `SUPPORTED_PACK_VERSIONS` is everything readers accept — every version ever
 * shipped stays in that set.
 */
const PACK_VERSION = '1'

const SUPPORTED_PACK_VERSIONS: ReadonlySet<string> = new Set([PACK_VERSION])

/** A packed field: base-36 digits only, which is what `packRanges` ever writes. */
const FIELD = /^[0-9a-z]+$/

const TOKEN_CLASS_INDEX: Readonly<Record<TokenClass, number>> = buildIndex()

function buildIndex(): Readonly<Record<TokenClass, number>> {
  // Every TOKEN_CLASSES entry gets an index below; the cast reflects that
  // completeness, which TypeScript cannot infer from a loop over a const tuple.
  const index = {} as Record<TokenClass, number>
  TOKEN_CLASSES.forEach((tokenClass, position) => {
    index[tokenClass] = position
  })
  return index
}

/** Packs `ranges` into a compact, versioned, HTML-attribute-safe string. */
export function packRanges(ranges: readonly TokenRange[]): string {
  const body = ranges
    .map((range) => {
      const length = range.end - range.start
      const typeIndex = TOKEN_CLASS_INDEX[range.type]
      return `${range.start.toString(36)},${length.toString(36)},${typeIndex.toString(36)}`
    })
    .join(';')
  return `${PACK_VERSION}:${body}`
}

/**
 * Unpacks a string produced by `packRanges` back into `TokenRange[]`.
 *
 * The version prefix is parsed and checked, never skipped: a payload written by
 * a format this build does not know is refused outright rather than read as if
 * it were version 1 (ADR-033). Everything else malformed — no prefix, the wrong
 * triple shape, a field that is not base 36, a negative offset, or a type index
 * outside `TOKEN_CLASSES` — throws for the same reason, because the caller is
 * reading an HTML attribute it did not necessarily write itself.
 */
export function unpackRanges(packed: string): TokenRange[] {
  const separator = packed.indexOf(':')
  if (separator === -1) {
    throw new Error(`packed token ranges have no version prefix: "${packed}"`)
  }
  const version = packed.slice(0, separator)
  if (!SUPPORTED_PACK_VERSIONS.has(version)) {
    throw new Error(`unsupported packed token range version "${version}"`)
  }
  const body = packed.slice(separator + 1)
  if (body.length === 0) return []
  return body.split(';').map(parseTriple)
}

function parseTriple(triple: string): TokenRange {
  const parts = triple.split(',')
  if (parts.length !== 3) {
    throw new Error(`malformed packed token range: "${triple}"`)
  }
  // Verified to have exactly 3 elements above; noUncheckedIndexedAccess
  // can't see that from a length check, hence the assertion.
  const [startPart, lengthPart, typeIndexPart] = parts as [string, string, string]
  // Matching the writer's alphabet exactly is what rejects a negative field: a
  // leading `-` would otherwise parse happily into an offset no text has.
  if (!FIELD.test(startPart) || !FIELD.test(lengthPart) || !FIELD.test(typeIndexPart)) {
    throw new Error(`malformed packed token range: "${triple}"`)
  }
  const start = Number.parseInt(startPart, 36)
  const length = Number.parseInt(lengthPart, 36)
  const type = TOKEN_CLASSES[Number.parseInt(typeIndexPart, 36)]
  if (type === undefined) {
    throw new Error(`malformed packed token range: "${triple}"`)
  }
  return { start, end: start + length, type }
}
