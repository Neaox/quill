import type { OfferedThemeId } from '../schema/theme-ids.ts'

/** ADR-028, onboarding step 2: three questions, one suggestion. */
export type OnboardingAnswers = {
  readonly content: 'runbooks-and-designs' | 'guides-and-references' | 'policies-and-process'
  readonly feel: 'precise' | 'editorial' | 'friendly'
  readonly density: 'compact' | 'comfortable'
}

export type BaseSuggestion = {
  readonly base: OfferedThemeId
  readonly reason: string
}

type Scores = Readonly<Record<OfferedThemeId, number>>

const CONTENT_SCORES: Readonly<Record<OnboardingAnswers['content'], Scores>> = {
  'runbooks-and-designs': { instrument: 2, calm: 0, editorial: 0, grid: 1, atelier: 0 },
  'guides-and-references': { instrument: 0, calm: 2, editorial: 1, grid: 2, atelier: 2 },
  'policies-and-process': { instrument: 0, calm: 2, editorial: 2, grid: 0, atelier: 0 },
}

const FEEL_SCORES: Readonly<Record<OnboardingAnswers['feel'], Scores>> = {
  precise: { instrument: 3, calm: 1, editorial: 0, grid: 2, atelier: 0 },
  editorial: { instrument: 0, calm: 0, editorial: 3, grid: 0, atelier: 0 },
  friendly: { instrument: 0, calm: 2, editorial: 0, grid: 0, atelier: 3 },
}

const DENSITY_SCORES: Readonly<Record<OnboardingAnswers['density'], Scores>> = {
  compact: { instrument: 1, calm: 0, editorial: 0, grid: 1, atelier: 0 },
  comfortable: { instrument: 0, calm: 1, editorial: 1, grid: 1, atelier: 1 },
}

const REASONS: Record<OfferedThemeId, string> = {
  instrument:
    'Instrument is precise and dense, which suits technical material that is scanned more often than it is read.',
  calm: 'Calm is quiet and sans-serif throughout, with one restrained accent, which suits guides that many people read and nobody should have to squint at.',
  editorial:
    'Editorial is a serif reading column on warm paper, which suits long documents that are read start to finish.',
  grid: 'Grid is crisp and hairline-drawn, with raised surfaces on a cool page, which suits reference documentation that is read closely but at ease.',
  atelier:
    'Atelier is warm and card-based with coloured collections, which suits a workspace people browse rather than search.',
}

const ORDER: readonly OfferedThemeId[] = ['instrument', 'calm', 'editorial', 'grid', 'atelier']

/**
 * Map the three answers onto a built-in theme. Ties fall to Instrument, which
 * ADR-028 makes the default for a new instance.
 */
export const suggestBase = (answers: OnboardingAnswers): BaseSuggestion => {
  const totals = ORDER.map((id) => ({
    id,
    score:
      CONTENT_SCORES[answers.content][id] +
      FEEL_SCORES[answers.feel][id] +
      DENSITY_SCORES[answers.density][id],
  }))
  const best = totals.reduce((winner, candidate) =>
    candidate.score > winner.score ? candidate : winner,
  )
  return { base: best.id, reason: REASONS[best.id] }
}
