export type { Adjustment, AdjustmentReason } from './colour/adjustment.ts'
export { describeAdjustment } from './colour/adjustment.ts'
export {
  CHROMA_BUDGET,
  DARK_CHROMA_REDUCTION,
  LIGHTNESS_BANDS,
  STATUS_HUE_BANDS,
  inBand,
  type Band,
  type Scheme,
} from './colour/bands.ts'
export {
  chromaCompensationFactor,
  compensateChroma,
  hueDistance,
  normaliseHue,
  shiftHueAway,
} from './colour/hue.ts'
export {
  formatOklch,
  isInGamut,
  mapIntoGamut,
  mix,
  parseColour,
  type Colour,
} from './colour/oklch.ts'
export {
  PALETTE_ROLES,
  PALETTE_TOKEN_ROLES,
  buildPalettes,
  type Palette,
  type PaletteRole,
  type ThemePalettes,
} from './colour/palette.ts'

export { apcaContrast, apcaLc } from './contrast/apca.ts'
export { bestTextOn, type TextChoice } from './contrast/best-text-on.ts'
export { CONTRAST_FLOORS, DECORATIVE_LC_BAND, type ContrastFloor } from './contrast/floors.ts'
export { nudgeLightnessUntil, type NudgeOptions, type NudgeResult } from './contrast/nudge.ts'
export { contrastRatio } from './contrast/wcag.ts'

export {
  DEFICIENCIES,
  deltaEOklab,
  pairSeparation,
  simulate,
  worstSeparation,
  type Deficiency,
  type NamedColour,
  type SeparationResult,
} from './doctor/cvd.ts'
export {
  DEFAULT_DOCTOR_OPTIONS,
  type DoctorOptions,
  type Rule,
  type RuleOutcome,
  type RuleStatus,
} from './doctor/rule.ts'
export { ALL_RULES, ENFORCED_RULE_ID } from './doctor/rules/all.ts'
export { reportOn, runThemeDoctor, type RuleResult, type ThemeReport } from './doctor/run.ts'

export {
  CURATED_FACES,
  CURATED_FACE_IDS,
  CURATED_FACE_LIST,
  curatedFace,
  type CuratedFace,
  type CuratedFaceId,
  type FaceLicence,
  type FaceRole,
} from './schema/faces.ts'
export {
  BUILTIN_THEME_IDS,
  LEVER_IDS,
  ThemeDocumentSchema,
  type BuiltinThemeId,
  type FaceReference,
  type LeverId,
  type ThemeDocument,
  type ThemeShape,
  type ThemeVariants,
} from './schema/theme-document.ts'
export { validateThemeDocument, type ThemeIssue, type ValidationResult } from './schema/validate.ts'

export { BUILTIN_THEMES, DEFAULT_THEME, builtinTheme } from './builtin/themes.ts'
export { atelier } from './builtin/atelier.ts'
export { instrument } from './builtin/instrument.ts'
export { press } from './builtin/press.ts'

export { extractSeedsFromColours, type ExtractedSeeds } from './onboarding/extract-seeds.ts'
export { forkTheme, resetToBase, type ThemeChanges } from './onboarding/fork-theme.ts'
export {
  suggestBase,
  type BaseSuggestion,
  type OnboardingAnswers,
} from './onboarding/suggest-base.ts'

export { toCss, type CssOptions } from './css.ts'
export { generateTheme, type GeneratedTheme } from './generate.ts'
export { fontStack, radiusScale, toTokenMap, type RadiusScale } from './token-map.ts'
export {
  PALETTE_TOKENS,
  SYNTAX_CLASSES,
  SYNTAX_CLASS_FAMILIES,
  SYNTAX_FAMILIES,
  SYNTAX_TOKENS,
  TOKEN_NAMES,
  type PaletteToken,
  type SyntaxClass,
  type SyntaxFamily,
  type SyntaxToken,
  type TokenMap,
  type TokenName,
  type TokenOverrides,
} from './tokens.ts'
