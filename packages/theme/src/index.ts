export type { Adjustment, AdjustmentReason } from './colour/adjustment.ts'
export { describeAdjustment } from './colour/adjustment.ts'
export {
  CHROMA_BUDGET,
  DARK_CHROMA_REDUCTION,
  LIGHTNESS_BANDS,
  RECOGNISABLE_CHROMA,
  SCHEMES,
  WASH_CHROMA_BUDGET,
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
  isPaletteRole,
  shortfall,
  type AdjustedColour,
  type AdjustmentEvidence,
  type ContrastEvidence,
  type ContrastTarget,
  type Evidence,
  type Measurement,
  type SwatchEvidence,
  type SwatchSample,
} from './doctor/evidence.ts'
export {
  SEVERITY_ORDER,
  bySeverity,
  severityCounts,
  severityOf,
  verdictOf,
  type Severity,
  type SeverityCount,
  type SeverityGroup,
  type Verdict,
} from './doctor/severity.ts'
export { acknowledgeRule, withdrawAcknowledgement } from './doctor/acknowledge.ts'
export {
  brandDistance,
  changeCost,
  greyDistance,
  isBrandRole,
  keepsTheBrand,
  keepsTheFeel,
  weightedDeltaE,
} from './doctor/feel.ts'
export {
  applyThemeChange,
  suggestFixes,
  type GroundRole,
  type NeutralStep,
  type OverrideScope,
  type SuggestOptions,
  type Suggestion,
  type ThemeChange,
} from './doctor/suggest.ts'

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
  SEED_CHROMA_MAX,
  OFFERED_THEME_IDS,
  SUPERSEDED_THEMES,
  ThemeDocumentSchema,
  type BuiltinThemeId,
  type FaceReference,
  type LabelSeedValue,
  type LeverId,
  type OfferedThemeId,
  type ReadingScaleValue,
  type ThemeDocument,
  type ThemeShape,
  type ThemeVariants,
  type ToneSeedValue,
} from './schema/theme-document.ts'
export { validateThemeDocument, type ThemeIssue, type ValidationResult } from './schema/validate.ts'
export {
  BUILT_IN_DIRECTIVE_NAMES,
  DEFAULT_LABEL_CHROMA,
  DRAWING_CLASS_NAMES,
  EMOJI_NAME_PATTERN,
  LABEL_NAME_PATTERN,
  labelNameProblem,
  MAX_LABELS,
} from './schema/labels.ts'
export type { LabelColours } from './colour/labels.ts'
export type { GeneratedLabel, LabelTokens } from './label-css.ts'

export {
  BUILTIN_THEMES,
  DEFAULT_THEME,
  OFFERED_THEMES,
  builtinTheme,
  recommendedLayout,
  successorOf,
  supersededBy,
} from './builtin/themes.ts'
export { atelier } from './builtin/atelier.ts'
export { calm } from './builtin/calm.ts'
export { editorial } from './builtin/editorial.ts'
export { grid } from './builtin/grid.ts'
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
export {
  DEFAULT_READING_SCALE,
  fontStack,
  proseTokens,
  radiusScale,
  readingSetting,
  toTokenMap,
  type RadiusScale,
  type ReadingSetting,
} from './token-map.ts'
export {
  PALETTE_TOKENS,
  PROSE_TOKENS,
  SYNTAX_CLASSES,
  SYNTAX_CLASS_FAMILIES,
  SYNTAX_FAMILIES,
  SYNTAX_TOKENS,
  TOKEN_NAMES,
  type PaletteToken,
  type ProseToken,
  type SyntaxClass,
  type SyntaxFamily,
  type SyntaxToken,
  type TokenMap,
  type TokenName,
  type TokenOverrides,
} from './tokens.ts'
export { cssString, fontFamilyName } from './css-string.ts'
export { fontFaceCss, themeFaces, type FontFaceOptions } from './font-face.ts'
export {
  CURATED_FACE_FILES,
  SUBSET_UNICODE_RANGES,
  type CuratedFaceFiles,
  type FaceFile,
  type FaceSubset,
} from './schema/face-files.ts'

export { ACCENT_TOKENS, withAccent } from './choice/accent-choice.ts'
export { describeColour, describeGreys } from './choice/describe.ts'
export {
  COLOUR_FAMILIES,
  INTENSITIES,
  choiceOfColour,
  familyOf,
  intensityOf,
  paintedColour,
  type ColourChoice,
  type ColourFamily,
  type Intensity,
} from './choice/colour-choice.ts'
export {
  COLOUR_FORMAT_IDS,
  readColour,
  type ColourFormat,
  type ColourReadError,
  type ReadColour,
} from './choice/read-colour.ts'
export {
  ACCENT_SWATCHES,
  choiceOfSwatch,
  swatchMatching,
  type AccentSwatch,
} from './choice/swatches.ts'
export {
  TONE_TEMPERATURES,
  TONE_TINTS,
  temperatureOf,
  tintOf,
  withTemperature,
  withTint,
  type ToneTemperature,
  type ToneTint,
} from './choice/tone-choice.ts'
export { chromaTrack, hueTrack } from './choice/tracks.ts'
export { COLOUR_WRITE_FORMATS, writeColour, type ColourWriteFormat } from './choice/write-colour.ts'
