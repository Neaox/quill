import type { ThemeDocument } from '../schema/theme-document.ts'

/**
 * A tenant may accept a warning their brand cannot avoid — a wash that cannot
 * be quietened without losing its teal — rather than be shown it as a problem
 * for ever. The acceptance is part of the theme document, so it travels with
 * the theme and is reviewed with it; the doctor still measures the rule and
 * still reports it, as accepted.
 */
export const acknowledgeRule = (theme: ThemeDocument, ruleId: string): ThemeDocument => {
  const current = theme.acknowledged ?? []
  return current.includes(ruleId) ? theme : { ...theme, acknowledged: [...current, ruleId] }
}

/** Puts an accepted warning back in front of the tenant; the list goes when it empties. */
export const withdrawAcknowledgement = (theme: ThemeDocument, ruleId: string): ThemeDocument => {
  const kept = (theme.acknowledged ?? []).filter((id) => id !== ruleId)
  const { acknowledged: _previous, ...rest } = theme
  return kept.length === 0 ? rest : { ...rest, acknowledged: kept }
}
