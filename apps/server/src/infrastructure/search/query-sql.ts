import type { FilterClause, PhraseClause, SearchQuery, TermClause } from '@quill/application'
import { normaliseTag, parsePropertyFilter } from '@quill/search'
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

/** Who is asking, as far as a filter needs to know: the accounts behind `me`. */
export interface Asker {
  readonly userIds: readonly string[]
}

export function translateQuery(query: SearchQuery, asker: Asker): TranslatedQuery {
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
    predicates: clauses.filter(isFilter).map((clause) => toPredicate(clause, asker)),
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
function toPredicate(clause: FilterClause, asker: Asker): SQL {
  const predicate = filterPredicate(clause, asker)
  return clause.negated ? sql`NOT coalesce(${predicate}, false)` : predicate
}

/**
 * `by:` — who has published a revision of the document.
 *
 * Three readings, in this order. `me` is the account the request is made as,
 * resolved to the address it publishes under. Anything with an `@` is an
 * address, matched exactly (a part of an address names nobody). Anything else
 * is a part of a name or an address, matched as plain text: `%` and `_` in it
 * are characters like any other, escaped so they cannot turn a stranger's
 * search into a pattern, and the escaped value still travels as a bound
 * parameter.
 */
function publishedBy(value: string, asker: Asker): SQL {
  const needle = value.trim().toLowerCase()
  if (needle === 'me') {
    return sql`${documentSearch.contributorEmails} && ARRAY(SELECT lower(trim(u.email)) FROM users u WHERE u.id = ANY(${sql.param([...asker.userIds])}::text[]))`
  }
  if (needle.includes('@')) {
    return sql`${documentSearch.contributorEmails} @> ARRAY[${needle}]::text[]`
  }
  const pattern = `%${needle.replace(/[\\%_]/gu, '\\$&')}%`
  return sql`${documentSearch.contributorsText} LIKE ${pattern} ESCAPE '\\'`
}

/**
 * `team:` — whether anyone in a team has published a revision of the document.
 *
 * A team is a group by its name, with the groups nested inside it, or a unit by
 * its name or slug, with all of its groups: a grant to "Engineering" reaches
 * "Engineering / Platform" (ADR-012), and so does a search. It is resolved
 * here, at the moment of the query, from the groups as they stand: nothing
 * about a team is stored in the index, so a person joining one needs no
 * reindex. A name that matches nothing is an empty set of people and so
 * matches no document, never every one.
 */
function publishedByTeam(value: string): SQL {
  const needle = value.trim().toLowerCase()
  return sql`${documentSearch.contributorEmails} && ARRAY(
    WITH RECURSIVE team(id) AS (
      SELECT g.id FROM groups g WHERE lower(g.name) = ${needle}
      UNION
      SELECT g.id FROM groups g JOIN organisational_units ou ON ou.id = g.unit_id
        WHERE lower(ou.name) = ${needle} OR lower(ou.slug) = ${needle}
      UNION
      SELECT child.id FROM groups child JOIN team t ON child.parent_id = t.id
    )
    SELECT lower(trim(u.email)) FROM users u
      JOIN group_members gm ON gm.user_id = u.id
      WHERE gm.group_id IN (SELECT id FROM team)
  )`
}

function filterPredicate(clause: FilterClause, asker: Asker): SQL {
  const value = clause.value
  switch (clause.key) {
    case 'title':
      return sql`to_tsvector('english', coalesce(${documentSearch.title}, '')) @@ plainto_tsquery('english', ${value})`
    // Tags are a hierarchy: `tag_paths` holds every tag and its ancestors, so
    // the parent finds its subtree by plain containment, served by GIN.
    case 'tag':
      return taggedWith(value)
    // Owners are stored folded to lower case (see `index-entry.ts`), so
    // containment is both case-insensitive and served by the GIN index.
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
    case 'by':
      return publishedBy(value, asker)
    case 'team':
      return publishedByTeam(value)
    case 'prop':
      return hasProperty(value)
  }
}

/**
 * `tag:` — the document carries the tag, or one beneath it.
 *
 * The value is read the way a tag is read when it is indexed
 * (`normaliseTag`), so `Area / Billing` and `area/billing` are one question. A
 * value that is no tag at all (`/`) is nothing, which matches no document
 * rather than every one.
 */
function taggedWith(value: string): SQL {
  const tag = normaliseTag(value)
  return tag === null ? sql`false` : sql`${documentSearch.tagPaths} @> ARRAY[${tag}]::text[]`
}

/**
 * `prop:key=value` — a front-matter key that is not a core field holds the
 * value, by containment in the `properties` document (a `jsonb_path_ops`
 * index serves it). Key and value travel as bound parameters, folded as the
 * index folded what it stored. A filter that is not `key=value` is a filter
 * that matches nothing, never everything.
 */
function hasProperty(value: string): SQL {
  const wanted = parsePropertyFilter(value)
  return wanted === null
    ? sql`false`
    : sql`${documentSearch.properties} @> jsonb_build_object(${wanted.key}::text, jsonb_build_array(${wanted.value}::text))`
}
