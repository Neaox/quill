/**
 * Ranking as data (ADR-010, quill-plan.md §15): every adapter reads the same
 * `RankingProfile` and translates it into its own engine's scoring — a
 * `tsvector` weight letter for Postgres, a ranking rule for Meilisearch —
 * rather than each adapter inventing its own notion of "title matters more
 * than body".
 */

/** How much a match in each field contributes, relative to the others. */
export interface FieldWeights {
  readonly title: number
  readonly headings: number
  readonly body: number
}

/** How a document's age affects its score: a multiplier that decays toward 1 (no boost) as the document gets older. */
export interface RecencyBoost {
  /** Days for the boost to fall to half its value. */
  readonly halfLifeDays: number
  /** The most a freshly updated document's score can be multiplied up by. */
  readonly maxBoost: number
}

/**
 * How search results favour the workspace the caller is currently in
 * (quill-plan.md §15): search is the one surface that crosses workspaces, so
 * a match in the current workspace outranks an equally relevant match
 * elsewhere, and matches elsewhere are offered as grouped suggestions rather
 * than interleaved into one list.
 */
export interface WorkspaceAffinity {
  /** Multiplier an adapter applies to a hit's score when it is in the caller's current workspace. */
  readonly currentWorkspaceBoost: number
  /** Whether matches outside the current workspace are grouped by workspace rather than left flat. */
  readonly groupOthersByWorkspace: boolean
}

export interface RankingProfile {
  readonly fieldWeights: FieldWeights
  readonly recencyBoost: RecencyBoost
  /** Multiplier applied when the query matched an exact quoted phrase rather than loose terms. */
  readonly exactPhraseBoost: number
  readonly workspaceAffinity: WorkspaceAffinity
}

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
