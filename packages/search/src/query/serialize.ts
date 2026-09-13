import type { QueryClause, SearchQuery } from './query.ts'

const NEEDS_QUOTING = /[\s"\\]/

/**
 * Renders a {@link SearchQuery} back to text {@link parseQuery} can read
 * again.
 *
 * A term never needs quoting: the parser is the only producer of
 * well-formed `TermClause`s and it never lets one hold whitespace. A filter
 * value can legitimately hold whitespace (`owner:"Jane Doe"` parses to a
 * `FilterClause` whose value is `Jane Doe`), so it is quoted and escaped
 * whenever it needs to be, the same way a phrase always is.
 */
export function serializeQuery(query: SearchQuery): string {
  return query.clauses.map(serializeClause).join(' ')
}

function serializeClause(clause: QueryClause): string {
  const sign = clause.negated ? '-' : ''
  switch (clause.kind) {
    case 'term':
      return `${sign}${clause.value}`
    case 'phrase':
      return `${sign}${quote(clause.value)}`
    case 'filter':
      return `${sign}${clause.key}:${serializeFilterValue(clause.value)}`
  }
}

function serializeFilterValue(value: string): string {
  return NEEDS_QUOTING.test(value) ? quote(value) : value
}

function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}
