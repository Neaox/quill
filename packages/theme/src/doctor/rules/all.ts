import type { Rule } from '../rule.ts'
import { lightnessBandRule, surfaceSeparationRule } from './bands.ts'
import { accentBudgetRule, areaBudgetRule, oneSaturatedThingRule } from './chroma.ts'
import { darkElevationRule, darkRecheckRule, darkRederivationRule } from './dark.ts'
import { neutralAgreementRule, statusHueRule, statusMatchRule } from './hue.ts'
import {
  darkInkAndPaperRule,
  decorativeTextRule,
  textContrastRule,
  textOnAccentRule,
  uiBoundaryRule,
} from './legibility.ts'
import { accentCoverageRule } from './proportion.ts'
import { chromaCompensationRule, gamutRule, rampHueRule } from './uniformity.ts'
import { accentSeparationRule, statusSeparationRule } from './vision.ts'

/** The rule that ADR-028 enforces by default; everything else advises. */
export const ENFORCED_RULE_ID = textContrastRule.id

/** Every measurable rule in `docs/design/colour-rules.md`, in section order. */
export const ALL_RULES: readonly Rule[] = [
  textContrastRule,
  uiBoundaryRule,
  decorativeTextRule,
  textOnAccentRule,
  darkInkAndPaperRule,
  rampHueRule,
  gamutRule,
  chromaCompensationRule,
  lightnessBandRule,
  surfaceSeparationRule,
  areaBudgetRule,
  accentBudgetRule,
  oneSaturatedThingRule,
  neutralAgreementRule,
  statusHueRule,
  statusMatchRule,
  accentCoverageRule,
  darkRederivationRule,
  darkElevationRule,
  darkRecheckRule,
  statusSeparationRule,
  accentSeparationRule,
]
