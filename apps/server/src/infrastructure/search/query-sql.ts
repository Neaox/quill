import type { FilterClause, PhraseClause, SearchQuery, TermClause } from '@quill/application'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { collections, documentSearch, workspaces } from '../db/schema.ts'

/**
 * The query language (`@quill/search`) in PostgreSQL's own terms (ADR-010).
 *
 * `parseQuery` has already done the reading: this only ever sees a structured
 * `SearchQuery`, so no user text is ever concatenated into SQL — every value
 * below travels as a bound parameter, including the ones that become a
 * `tsquery`, which Postgres parses itself through `plainto_tsquery` and
 * `phraseto_tsquery` rather than having a query syntax hand-assembled for it.
 */

export interface TranslatedQuery {
  /**
   * Every positive clause, ANDed: what the author literally asked for. Null
   * when the query names no text at all — an empty box, or one that is only
   * field filters, which lists what matches the filters rather than nothing.
   */
  readonly all: SQL | null
  /** The same clauses ORed: the widening `PostgresSearchIndex` falls back to when the AND finds too little. */
  readonly any: SQL | null
  /** Everything the author excluded with `-`, as one `tsquery`, or null. */
  readonly exclude: SQL | null
  /** The quoted phrases alone, for `RankingProfile.exactPhraseBoost`, or null. */
  readonly phrases: SQL | null
  /** Whether the author quoted anything. A phrase is an exact demand, so nothing fuzzy may widen past it. */
  readonly hasPhrase: boolean
  /** Whether `all` and `any` are actually different queries: with one clause they are the same. */
  readonly widenable: boolean
  /** The field filters, each already a predicate over `document_search`. */
  readonly predicates: readonly SQL[]
  /** The positive free text, for trigram typo tolerance. Empty when there is none. */
  readonly text: string
}

export function translateQuery(query: SearchQuery): TranslatedQuery {
  const clauses = [...query.clauses]
  const positive = clauses.filter(isMatchable).filter((clause) => !clause.negated)
  const negative = clauses.filter(isMatchable).filter((clause) => clause.negated)
  const phrases = positive.filter((clause) => clause.kind === 'phrase')

  return {
    all: allOfQueries(positive),
    any: anyOfQueries(positive),
    exclude: anyOfQueries(negative),
    phrases: allOfQueries(phrases),
    hasPhrase: phrases.length > 0,
    widenable: positive.length > 1,
    predicates: clauses.filter(isFilter).map(toPredicate),
    text: positive.map((clause) => clause.value).join(' '),
  }
}

function isMatchable(clause: SearchQuery['clauses'][number]): clause is TermClause | PhraseClause {
  return clause.kind !== 'filter'
}

function isFilter(clause: SearchQuery['clauses'][number]): clause is FilterClause {
  return clause.kind === 'filter'
}

/** One clause as a `tsquery`: a phrase keeps its word order, a term does not. */
function toTsQuery(clause: TermClause | PhraseClause): SQL {
  return clause.kind === 'phrase'
    ? sql`phraseto_tsquery('english', ${clause.value})`
    : sql`plainto_tsquery('english', ${clause.value})`
}

/**
 * The clauses combined with `||`: a document matching any one of them is a
 * candidate. This is the widening, not the default — see
 * `PostgresSearchIndex` for when it is reached for and why.
 */
function anyOfQueries(clauses: readonly (TermClause | PhraseClause)[]): SQL | null {
  return combineQueries(clauses, sql.raw('||'))
}

/** The clauses combined with `&&`: every one of them has to match. */
function allOfQueries(clauses: readonly (TermClause | PhraseClause)[]): SQL | null {
  return combineQueries(clauses, sql.raw('&&'))
}

function combineQueries(
  clauses: readonly (TermClause | PhraseClause)[],
  operator: SQL,
): SQL | null {
  if (clauses.length === 0) return null
  return clauses.map(toTsQuery).reduce((combined, next) => sql`(${combined} ${operator} ${next})`)
}

/**
 * One field filter as a predicate.
 *
 * A negated filter is wrapped in `COALESCE(..., false)` before it is negated,
 * because a predicate over a null column is null rather than false, and
 * `NOT null` would silently drop every document that has no collection from
 * the answer to `-collection:archive`.
 */
function toPredicate(clause: FilterClause): SQL {
  const predicate = filterPredicate(clause)
  return clause.negated ? sql`NOT coalesce(${predicate}, false)` : predicate
}

function filterPredicate(clause: FilterClause): SQL {
  const value = clause.value
  switch (clause.key) {
    case 'title':
      return sql`to_tsvector('english', coalesce(${documentSearch.title}, '')) @@ plainto_tsquery('english', ${value})`
    // Tags and owners are stored folded to lower case (see `index-entry.ts`),
    // so containment is both case-insensitive and served by the GIN index.
    case 'tag':
      return sql`${documentSearch.tags} @> ARRAY[lower(${value})]::text[]`
    case 'owner':
      return sql`${documentSearch.owners} @> ARRAY[lower(${value})]::text[]`
    case 'status':
      return sql`lower(${documentSearch.status}) = lower(${value})`
    case 'collection':
      return sql`${documentSearch.collectionId} IN (SELECT ${collections.id} FROM ${collections} WHERE ${collections.id} = ${value} OR lower(${collections.slug}) = lower(${value}) OR lower(${collections.name}) = lower(${value}))`
    // `in:` names a workspace. It can only ever narrow the search: the
    // visibility filter is ANDed with it, so naming a workspace the caller
    // cannot read simply matches nothing (ADR-012).
    case 'in':
      return sql`${documentSearch.workspaceId} IN (SELECT ${workspaces.id} FROM ${workspaces} WHERE ${workspaces.id} = ${value} OR lower(${workspaces.slug}) = lower(${value}) OR lower(${workspaces.name}) = lower(${value}))`
  }
}
