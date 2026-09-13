import type { RankingProfile } from '@quill/application/ports'

/**
 * Ranking as data (ADR-010, quill-plan.md §15): every adapter reads the same
 * `RankingProfile` and translates it into its own engine's scoring — a
 * `tsvector` weight letter for Postgres, a ranking rule for Meilisearch —
 * rather than each adapter inventing its own notion of "title matters more
 * than body". The shapes belong to the search port (`@quill/application`'s
 * `ports/search-index.ts`); the numbers and the decay curve are here.
 */

export type {
  FieldWeights,
  RankingProfile,
  RecencyBoost,
  WorkspaceAffinity,
} from '@quill/application/ports'

/**
 * The defaults every adapter starts from. Pinned by a test: changing a
 * number here is a ranking-quality decision (ADR-010 leaves that to R9), not
 * an incidental refactor, so the test makes it visible in a diff.
 */
export const DEFAULT_RANKING_PROFILE: RankingProfile = {
  fieldWeights: { title: 10, headings: 5, body: 1 },
  recencyBoost: { halfLifeDays: 90, maxBoost: 0.2 },
  exactPhraseBoost: 2,
  workspaceAffinity: { currentWorkspaceBoost: 2, groupOthersByWorkspace: true },
}

/**
 * The recency multiplier for a document last updated `ageDays` ago: at most
 * `1 + maxBoost` the moment it publishes, decaying by half every
 * `halfLifeDays` and approaching 1 (no boost at all) as it ages.
 */
export function recencyMultiplier(profile: RankingProfile, ageDays: number): number {
  const { halfLifeDays, maxBoost } = profile.recencyBoost
  const clampedAge = Math.max(ageDays, 0)
  const decay = 2 ** (-clampedAge / halfLifeDays)
  return 1 + maxBoost * decay
}
