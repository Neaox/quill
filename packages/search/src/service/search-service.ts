import type { Result } from '@quill/domain'
import { ok } from '@quill/domain'

import { parseQuery, type QueryParseError } from '../query/parse.ts'
import type { PhraseClause, SearchQuery, TermClause } from '../query/query.ts'
import { DEFAULT_RANKING_PROFILE, type RankingProfile } from '../ranking/ranking-profile.ts'
import { buildSnippet } from '../snippet/snippet.ts'
import { groupByWorkspaceAffinity } from './group-by-workspace-affinity.ts'
import type { SearchRequest } from './search-request.ts'
import type { SearchHit, SearchIndex } from './search-index.ts'
import type { SearchServiceHit, SearchServiceResults } from './search-result.ts'

const DEFAULT_LIMIT = 20

export interface SearchService {
  readonly profile: RankingProfile
  search(request: SearchRequest): Promise<Result<SearchServiceResults, QueryParseError>>
}

/**
 * Composes the search core end to end — the factory-plus-strategy shape
 * `docs/architecture/patterns.md` prescribes: `createX(config)` returning a
 * ready-to-use `X`, here choosing the ranking profile it runs with.
 *
 * The pipeline is parse -> the engine's `search` (which applies the
 * request's mandatory `VisibilityFilter` *inside* the query and the
 * `RankingProfile` to its own scoring) -> a snippet built from each hit's
 * own body text -> grouping by workspace affinity. `index` is this
 * package's own `SearchIndex` (`./search-index.ts`; see its doc comment for
 * how it relates to `@quill/application`'s port of the same name).
 * `profile` defaults to `DEFAULT_RANKING_PROFILE` when a caller has no
 * reason to override it.
 */
export function createSearchService(
  index: SearchIndex,
  profile: RankingProfile = DEFAULT_RANKING_PROFILE,
): SearchService {
  return {
    profile,

    async search(request) {
      const parsed = parseQuery(request.queryText)
      if (!parsed.ok) return parsed

      const hits = await index.search(parsed.value, request.filter, profile, {
        limit: request.limit ?? DEFAULT_LIMIT,
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        ...(request.currentWorkspaceId === undefined
          ? {}
          : { currentWorkspaceId: request.currentWorkspaceId }),
      })

      const terms = matchableTerms(parsed.value.clauses)
      const scored = hits.hits.map((hit) => toServiceHit(hit, terms))
      const { current, elsewhere } = groupByWorkspaceAffinity(scored, request.currentWorkspaceId)

      return ok({
        current,
        elsewhere,
        ...(hits.nextCursor === undefined ? {} : { nextCursor: hits.nextCursor }),
      })
    },
  }
}

/** The words worth highlighting: positive terms and phrases, never an exclusion or a field filter's value. */
function matchableTerms(clauses: SearchQuery['clauses']): readonly string[] {
  return clauses
    .filter(
      (clause): clause is TermClause | PhraseClause => clause.kind !== 'filter' && !clause.negated,
    )
    .map((clause) => clause.value)
}

function toServiceHit(hit: SearchHit, terms: readonly string[]): SearchServiceHit {
  return {
    documentId: hit.documentId,
    workspaceId: hit.workspaceId,
    title: hit.title,
    snippet: buildSnippet(hit.body, terms),
    score: hit.score,
  }
}
