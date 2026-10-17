import { rankSuggestions, suggestion } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import type { IndexableDocument, IndexableHeading } from '../document/indexable-document.ts'
import { expandTagPaths, normaliseTag } from '../document/tags.ts'
import { addCounts, rankFacetCounts } from '../facets/facet-counts.ts'
import { parsePropertyFilter } from '../query/property-filter.ts'
import type { FilterClause, PhraseClause, SearchQuery, TermClause } from '../query/query.ts'
import {
  DEFAULT_RANKING_PROFILE,
  recencyMultiplier,
  type RankingProfile,
} from '../ranking/ranking-profile.ts'
import type { VisibilityFilter } from '../visibility/visibility-filter.ts'
import type {
  FacetCounts,
  FacetName,
  FacetsOptions,
  SearchHit,
  SearchHits,
  SearchIndex,
  SearchIndexQueryOptions,
} from '../service/search-index.ts'

/**
 * What a real engine reads from the accounts and groups it shares a database
 * with, for `by:me` and `team:`. The fake has no users or groups of its own, so
 * a test says who they are. Without one, `me` is nobody and a team has no
 * members: both find nothing, which is also what the engine does for a name it
 * does not know.
 */
export interface InMemoryDirectory {
  /** The address of the user a principal key (`user:<id>`) names. */
  emailOf(userKey: string): string | undefined
  /** The addresses of everyone in the team of that name, nested groups included. */
  teamMembers(name: string): readonly string[]
  /**
   * Whether an address belongs to an account here. `by:` suggestions name
   * accounts and not every Git-synced author; without this every contributor
   * counts as one.
   */
  hasAccount?(email: string): boolean
}

export interface InMemorySearchIndexOptions {
  /** Defaults to a fixed instant, so a test pinning recency-boosted scores never depends on the wall clock. */
  readonly now?: () => Date
  readonly directory?: InMemoryDirectory
}

/** What a filter on people is answered from, for one query. */
interface People {
  readonly askerEmails: ReadonlySet<string>
  readonly teamMembers: (name: string) => readonly string[]
}

/**
 * An in-memory `SearchIndex` (`../service/search-index.ts`) for testing the
 * composition `createSearchService` builds — parse, visibility, ranking
 * data, snippets, workspace-affinity grouping — end to end without a real
 * engine. Scoring is deliberately simple substring matching, weighted by
 * `RankingProfile`: it exists to prove the pipeline wires together
 * correctly, not to stand in for ranking-quality work a real engine (or R9)
 * does.
 *
 * Visibility here is a document-to-principal allow list set with
 * {@link InMemorySearchIndex.grant}, because — unlike the workspace scope,
 * which `IndexableDocument.workspaceId` already carries — nothing in an
 * indexed document says who may read it: a real adapter joins the separate,
 * materialised permission table (ADR-010, ADR-012) to answer that, which
 * this fake has no reason to reimplement. A document nobody has granted
 * anything is visible to every principal once its workspace is in scope,
 * matching how `EffectivePermissionRow`'s absence of a deny is read
 * elsewhere.
 */
export interface InMemorySearchIndex extends SearchIndex {
  grant(documentId: DocumentId, principalKeys: readonly string[]): void
}

export function createInMemorySearchIndex(
  indexOptions: InMemorySearchIndexOptions = {},
): InMemorySearchIndex {
  const now = indexOptions.now ?? ((): Date => new Date('2026-01-01T00:00:00.000Z'))
  const documents = new Map<DocumentId, IndexableDocument>()
  const grants = new Map<DocumentId, ReadonlySet<string>>()

  return {
    async index(doc) {
      documents.set(doc.documentId, doc)
    },

    async remove(documentId) {
      documents.delete(documentId)
      grants.delete(documentId)
    },

    grant(documentId, principalKeys) {
      grants.set(documentId, new Set(principalKeys))
    },

    async suggest(request, filter) {
      const workspaces = new Set(filter.workspaceIds)
      const visible = [...documents.values()].filter(
        (doc) => workspaces.has(doc.workspaceId) && isVisible(doc.documentId, grants, filter),
      )
      const values =
        request.field === 'tag'
          ? visible.flatMap((doc) => expandTagPaths(doc.tags))
          : visible.flatMap((doc) =>
              doc.contributors
                .filter(
                  (contributor) => indexOptions.directory?.hasAccount?.(contributor.email) ?? true,
                )
                .map((contributor) => contributor.name)
                .filter((name) => !name.includes('@')),
            )
      return rankSuggestions(values.map(suggestion), request.prefix, request.limit).map(
        (found) => found.value,
      )
    },

    async facets(query, filter, facetOptions) {
      const workspaces = new Set(filter.workspaceIds)
      const people = peopleFor(filter, indexOptions.directory)
      // Every word has to appear, as in the engine's strict match: scoring is
      // beside the point here, only whether the document is a match at all.
      const matching = [...documents.values()].filter(
        (doc) =>
          workspaces.has(doc.workspaceId) &&
          isVisible(doc.documentId, grants, filter) &&
          matchesQuery(doc, query, people),
      )
      return countFacets(matching, facetOptions)
    },

    async search(query, filter, profile, queryOptions) {
      return runQuery(
        documents,
        grants,
        query,
        filter,
        profile,
        queryOptions,
        now(),
        peopleFor(filter, indexOptions.directory),
      )
    },
  }
}

function peopleFor(filter: VisibilityFilter, directory: InMemoryDirectory | undefined): People {
  const asker = filter.principalKeys.flatMap((key) => directory?.emailOf(key) ?? [])
  return {
    askerEmails: new Set(asker.map((email) => email.toLowerCase())),
    teamMembers: (name) => directory?.teamMembers(name) ?? [],
  }
}

/** What each facet counts a document under: its tag paths, its status, its collection. */
const FACET_VALUES: Record<FacetName, (doc: IndexableDocument) => readonly string[]> = {
  tag: (doc) => expandTagPaths(doc.tags),
  status: (doc) => [doc.status],
  collection: (doc) => (doc.collectionId === null ? [] : [doc.collectionId]),
}

function countFacets(matching: readonly IndexableDocument[], options: FacetsOptions): FacetCounts {
  return Object.fromEntries(
    options.facets.map((facet) => {
      const counts = new Map<string, number>()
      for (const doc of matching) {
        addCounts(
          counts,
          FACET_VALUES[facet](doc).map((value) => ({ value, count: 1 })),
        )
      }
      // Collections come back whole: the application merges the ones that share a name.
      return [facet, rankFacetCounts(counts, facet === 'collection' ? counts.size : options.limit)]
    }),
  )
}

interface ScoredDocument {
  readonly doc: IndexableDocument
  readonly score: number
}

function runQuery(
  documents: ReadonlyMap<DocumentId, IndexableDocument>,
  grants: ReadonlyMap<DocumentId, ReadonlySet<string>>,
  query: SearchQuery,
  filter: VisibilityFilter,
  profile: RankingProfile,
  options: SearchIndexQueryOptions,
  now: Date,
  people: People,
): SearchHits {
  const workspaces = new Set(filter.workspaceIds)

  const matches = [...documents.values()]
    .filter((doc) => workspaces.has(doc.workspaceId) && isVisible(doc.documentId, grants, filter))
    .map((doc) => scoreDocument(doc, query, profile, options, now, people))
    .filter((scored): scored is ScoredDocument => scored !== null)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, options.limit)

  return {
    hits: matches.map(({ doc, score }): SearchHit => ({
      documentId: doc.documentId,
      workspaceId: doc.workspaceId,
      title: doc.title,
      body: doc.body,
      tags: doc.tags,
      score,
    })),
  }
}

function isVisible(
  documentId: DocumentId,
  grants: ReadonlyMap<DocumentId, ReadonlySet<string>>,
  filter: VisibilityFilter,
): boolean {
  const allowed = grants.get(documentId)
  if (allowed === undefined) return true
  return filter.principalKeys.some((key) => allowed.has(key))
}

function matchesQuery(doc: IndexableDocument, query: SearchQuery, people: People): boolean {
  return query.clauses.every((clause) => {
    if (clause.kind === 'filter') return satisfiesFilter(doc, clause, people)
    const matched = matchScoreFor(doc, clause, DEFAULT_RANKING_PROFILE) > 0
    return clause.negated ? !matched : matched
  })
}

/** Null when `doc` does not satisfy the query at all; otherwise its weighted score. */
function scoreDocument(
  doc: IndexableDocument,
  query: SearchQuery,
  profile: RankingProfile,
  options: SearchIndexQueryOptions,
  now: Date,
  people: People,
): ScoredDocument | null {
  let score = 0

  for (const clause of query.clauses) {
    if (clause.kind === 'filter') {
      if (!satisfiesFilter(doc, clause, people)) return null
      continue
    }

    const matchScore = matchScoreFor(doc, clause, profile)
    if (clause.negated) {
      if (matchScore > 0) return null
      continue
    }
    if (matchScore === 0) return null
    score += matchScore
  }

  const ageDays = Math.max(0, (now.getTime() - doc.updatedAt.getTime()) / (24 * 60 * 60 * 1000))
  score *= recencyMultiplier(profile, ageDays)

  if (options.currentWorkspaceId !== undefined && doc.workspaceId === options.currentWorkspaceId) {
    score *= profile.workspaceAffinity.currentWorkspaceBoost
  }

  return { doc, score: score === 0 ? baselineScore(profile) : score }
}

/** A query with no positive term or phrase (only filters, or nothing at all) still matches; every candidate ties on this baseline. */
function baselineScore(profile: RankingProfile): number {
  return profile.fieldWeights.body
}

function matchScoreFor(
  doc: IndexableDocument,
  clause: TermClause | PhraseClause,
  profile: RankingProfile,
): number {
  const needle = clause.value.toLowerCase()
  if (needle.length === 0) return 0
  const boost = clause.kind === 'phrase' ? profile.exactPhraseBoost : 1

  let score = 0
  if (doc.title.toLowerCase().includes(needle)) score += profile.fieldWeights.title * boost
  score += headingMatchScore(doc.headings, needle, profile) * boost
  if (doc.body.toLowerCase().includes(needle)) score += profile.fieldWeights.body * boost
  return score
}

function headingMatchScore(
  headings: readonly IndexableHeading[],
  needle: string,
  profile: RankingProfile,
): number {
  return headings
    .filter((heading) => heading.text.toLowerCase().includes(needle))
    .reduce((total, heading) => total + profile.fieldWeights.headings * heading.weight, 0)
}

function satisfiesFilter(doc: IndexableDocument, clause: FilterClause, people: People): boolean {
  const matches = filterMatches(doc, clause, people)
  return clause.negated ? !matches : matches
}

function filterMatches(doc: IndexableDocument, clause: FilterClause, people: People): boolean {
  const needle = clause.value.toLowerCase()
  switch (clause.key) {
    case 'title':
      return doc.title.toLowerCase().includes(needle)
    case 'tag': {
      const wanted = normaliseTag(clause.value)
      return wanted !== null && expandTagPaths(doc.tags).includes(wanted)
    }
    case 'owner':
      return doc.owners.some((owner) => owner.toLowerCase() === needle)
    case 'status':
      return doc.status.toLowerCase() === needle
    case 'collection':
      return doc.collectionId !== null && doc.collectionId.toLowerCase() === needle
    case 'in':
      // The workspace scope this fake already enforces from `filter.workspaceIds`;
      // `in:workspace` names that same scope rather than adding a new one.
      return true
    case 'by':
      return publishedBy(doc, needle, people)
    case 'prop': {
      const wanted = parsePropertyFilter(clause.value)
      if (wanted === null) return false
      const values = Object.hasOwn(doc.properties, wanted.key)
        ? doc.properties[wanted.key]
        : undefined
      return values?.includes(wanted.value) ?? false
    }
    case 'team': {
      const members = new Set(people.teamMembers(needle).map((email) => email.toLowerCase()))
      return doc.contributors.some((contributor) => members.has(contributor.email))
    }
  }
}

/**
 * `me` is whoever is asking; an address is matched exactly; anything else is a
 * part of a name or an address, whatever its case. The same three readings the
 * engine's SQL gives, so what a test sees here is what a person sees there.
 */
function publishedBy(doc: IndexableDocument, needle: string, people: People): boolean {
  if (needle === 'me') {
    return doc.contributors.some((contributor) => people.askerEmails.has(contributor.email))
  }
  if (needle.includes('@')) {
    return doc.contributors.some((contributor) => contributor.email === needle)
  }
  return doc.contributors.some((contributor) =>
    `${contributor.name} ${contributor.email}`.toLowerCase().includes(needle),
  )
}
