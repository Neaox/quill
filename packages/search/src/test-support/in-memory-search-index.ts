import type { DocumentId } from '@quill/domain'

import type { IndexableDocument, IndexableHeading } from '../document/indexable-document.ts'
import type { FilterClause, PhraseClause, SearchQuery, TermClause } from '../query/query.ts'
import { recencyMultiplier, type RankingProfile } from '../ranking/ranking-profile.ts'
import type { VisibilityFilter } from '../visibility/visibility-filter.ts'
import type {
  SearchHit,
  SearchHits,
  SearchIndex,
  SearchIndexQueryOptions,
} from '../service/search-index.ts'

export interface InMemorySearchIndexOptions {
  /** Defaults to a fixed instant, so a test pinning recency-boosted scores never depends on the wall clock. */
  readonly now?: () => Date
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

    async search(query, filter, profile, queryOptions) {
      return runQuery(documents, grants, query, filter, profile, queryOptions, now())
    },
  }
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
): SearchHits {
  const workspaces = new Set(filter.workspaceIds)

  const matches = [...documents.values()]
    .filter((doc) => workspaces.has(doc.workspaceId) && isVisible(doc.documentId, grants, filter))
    .map((doc) => scoreDocument(doc, query, profile, options, now))
    .filter((scored): scored is ScoredDocument => scored !== null)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, options.limit)

  return {
    hits: matches.map(({ doc, score }): SearchHit => ({
      documentId: doc.documentId,
      workspaceId: doc.workspaceId,
      title: doc.title,
      body: doc.body,
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

/** Null when `doc` does not satisfy the query at all; otherwise its weighted score. */
function scoreDocument(
  doc: IndexableDocument,
  query: SearchQuery,
  profile: RankingProfile,
  options: SearchIndexQueryOptions,
  now: Date,
): ScoredDocument | null {
  let score = 0

  for (const clause of query.clauses) {
    if (clause.kind === 'filter') {
      if (!satisfiesFilter(doc, clause)) return null
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

function satisfiesFilter(doc: IndexableDocument, clause: FilterClause): boolean {
  const matches = filterMatches(doc, clause)
  return clause.negated ? !matches : matches
}

function filterMatches(doc: IndexableDocument, clause: FilterClause): boolean {
  const needle = clause.value.toLowerCase()
  switch (clause.key) {
    case 'title':
      return doc.title.toLowerCase().includes(needle)
    case 'tag':
      return doc.tags.some((tag) => tag.toLowerCase() === needle)
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
  }
}
