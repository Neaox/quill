import type { BuiltinThemeId } from '../schema/theme-document.ts'

/** ADR-028, onboarding step 2: three questions, one suggestion. */
export type OnboardingAnswers = {
  readonly content: 'runbooks-and-designs' | 'guides-and-references' | 'policies-and-process'
  readonly feel: 'precise' | 'editorial' | 'friendly'
  readonly density: 'compact' | 'comfortable'
}

export type BaseSuggestion = {
  readonly base: BuiltinThemeId
  readonly reason: string
}

type Scores = Readonly<Record<BuiltinThemeId, number>>

const CONTENT_SCORES: Readonly<Record<OnboardingAnswers['content'], Scores>> = {
  'runbooks-and-designs': { instrument: 2, press: 0, atelier: 0 },
  'guides-and-references': { instrument: 0, press: 1, atelier: 1 },
  'policies-and-process': { instrument: 0, press: 2, atelier: 0 },
}

const FEEL_SCORES: Readonly<Record<OnboardingAnswers['feel'], Scores>> = {
  precise: { instrument: 3, press: 0, atelier: 0 },
  editorial: { instrument: 0, press: 3, atelier: 0 },
  friendly: { instrument: 0, press: 0, atelier: 3 },
}

const DENSITY_SCORES: Readonly<Record<OnboardingAnswers['density'], Scores>> = {
  compact: { instrument: 1, press: 0, atelier: 0 },
  comfortable: { instrument: 0, press: 1, atelier: 1 },
}

const REASONS: Record<BuiltinThemeId, string> = {
  instrument:
    'Instrument is precise and dense, which suits technical material that is scanned more often than it is read.',
  press:
    'Press is editorial, with a serif reading surface and sidenotes, which suits long documents that are read start to finish.',
  atelier:
    'Atelier is warm and card-based with coloured collections, which suits a workspace people browse rather than search.',
}

const ORDER: readonly BuiltinThemeId[] = ['instrument', 'press', 'atelier']

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
