import { type Static, Type } from '@sinclair/typebox'

import { BRAND } from '@quill/brand'
import { TOKEN_NAMES } from '../tokens.ts'
import { CURATED_FACE_IDS } from './faces.ts'
import { EMOJI_NAME_PATTERN, LABEL_NAME_PATTERN, MAX_LABELS } from './labels.ts'
import { BUILTIN_THEME_IDS } from './theme-ids.ts'

/** ADR-028, layer 1: a theme is a declarative document, never CSS. */

export {
  BUILTIN_THEME_IDS,
  OFFERED_THEME_IDS,
  SUPERSEDED_THEMES,
  type BuiltinThemeId,
  type OfferedThemeId,
} from './theme-ids.ts'

export const LEVER_IDS = [
  'accent',
  'tone',
  'logo',
  'reading-face',
  'radius',
  'density',
  'collection-colours',
] as const
export type LeverId = (typeof LEVER_IDS)[number]

const literalUnion = <T extends string>(values: readonly T[]) =>
  Type.Union(values.map((value) => Type.Literal(value)))

const Hue = Type.Number({ minimum: 0, exclusiveMaximum: 360 })
const Lightness = Type.Number({ minimum: 0, maximum: 100 })

/**
 * Where a neutral role sits on the lightness axis, when a theme wants its own
 * register rather than the shared one (`TARGET_LIGHTNESS` in `bands.ts`).
 *
 * These are starting points, exactly like the shared targets: the generator
 * still settles every text role against the contrast floors and the doctor
 * still judges every role against its band, so a step can move a theme
 * within the rules but never out of them. Hue and chroma stay the tone's, so
 * the tone lever keeps working on a theme that sets its own steps.
 */
const NeutralSteps = Type.Object(
  {
    paper: Type.Optional(Lightness),
    surface: Type.Optional(Lightness),
    raised: Type.Optional(Lightness),
    border: Type.Optional(Lightness),
    muted: Type.Optional(Lightness),
    body: Type.Optional(Lightness),
    ink: Type.Optional(Lightness),
  },
  { additionalProperties: false },
)

/** The most chroma a seed may ask for; a picker's range is the schema's. */
export const SEED_CHROMA_MAX = { tone: 0.04, accent: 0.37 } as const

const ToneSeed = Type.Object(
  {
    hue: Hue,
    /** Neutrals are tinted, not coloured: the area effect caps them hard. */
    chroma: Type.Number({ minimum: 0, maximum: SEED_CHROMA_MAX.tone }),
    steps: Type.Optional(
      Type.Object(
        { light: Type.Optional(NeutralSteps), dark: Type.Optional(NeutralSteps) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)

const AccentSeed = Type.Object(
  {
    hue: Hue,
    chroma: Type.Number({ minimum: 0, maximum: SEED_CHROMA_MAX.accent }),
    /** The tenant's exact lightness, kept for the mark where it is unsafe for text. */
    lightness: Type.Optional(Lightness),
    /**
     * Where the accent starts in dark mode, for a brand that states one. Left
     * out, dark mode starts from the light lightness clamped into the dark
     * band, which lands at the bottom of it; a brand whose dark accent is a
     * bright tint says so here. The contrast floors still settle it.
     */
    darkLightness: Type.Optional(Lightness),
  },
  { additionalProperties: false },
)

const StatusOverride = Type.Object(
  { hue: Hue, chroma: Type.Optional(Type.Number({ minimum: 0, maximum: 0.37 })) },
  { additionalProperties: false },
)

const Seeds = Type.Object(
  {
    tone: ToneSeed,
    accent: AccentSeed,
    statusOverrides: Type.Optional(
      Type.Object(
        {
          success: Type.Optional(StatusOverride),
          warning: Type.Optional(StatusOverride),
          danger: Type.Optional(StatusOverride),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)

const CuratedFaceRef = Type.Object(
  { source: Type.Literal('curated'), id: literalUnion(CURATED_FACE_IDS) },
  { additionalProperties: false },
)

const UploadedFaceRef = Type.Object(
  {
    source: Type.Literal('uploaded'),
    family: Type.String({ minLength: 1 }),
    url: Type.String({ minLength: 1 }),
    generic: literalUnion(['serif', 'sans-serif', 'monospace'] as const),
    licence: Type.Object(
      {
        name: Type.String({ minLength: 1 }),
        url: Type.Optional(Type.String({ minLength: 1 })),
        holder: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

const FaceRef = Type.Union([CuratedFaceRef, UploadedFaceRef])

/** A size in CSS pixels, as a designer states it; the generator serves it relative to the body. */
const Pixels = Type.Number({ minimum: 10, maximum: 64 })
const Leading = Type.Number({ minimum: 1, maximum: 2 })
const Weight = Type.Number({ minimum: 300, maximum: 800 })
/** Letter spacing in em. */
const Tracking = Type.Number({ minimum: -0.08, maximum: 0.2 })

/** One heading level: its size and line height in pixels, its weight, its tracking. */
const HeadingSetting = Type.Object(
  {
    size: Pixels,
    lineHeight: Pixels,
    weight: Type.Optional(Weight),
    tracking: Type.Optional(Tracking),
  },
  { additionalProperties: false },
)

/**
 * The reading setting: how large running text is, how far apart its lines
 * sit, how wide the column is, and the steps of the scale above and around
 * it. Every size is stated in pixels at the theme's own body size and served
 * as an `em` of it, so the presentation surface, which raises the body size
 * for a projector, still rescales the whole document together (ADR-028's
 * amendment of 11 October 2026). The bounds are the range the survey
 * measured on documentation people admire; outside them a theme stops being
 * a reading surface. Anything left out reads as the shared setting.
 */
const ReadingScale = Type.Object(
  {
    /** The body size in CSS pixels. */
    size: Type.Optional(Type.Number({ minimum: 14, maximum: 20 })),
    /** The body line height, unitless. */
    leading: Type.Optional(Type.Number({ minimum: 1.4, maximum: 1.9 })),
    /** The content column, in rem; never wider than the `wide` track. */
    measure: Type.Optional(Type.Number({ minimum: 32, maximum: 48 })),
    /** The paragraph straight after the title. */
    lede: Type.Optional(
      Type.Object({ size: Pixels, lineHeight: Pixels }, { additionalProperties: false }),
    ),
    h1: Type.Optional(HeadingSetting),
    h2: Type.Optional(HeadingSetting),
    h3: Type.Optional(HeadingSetting),
    /** h4 and every level below it. */
    h4: Type.Optional(HeadingSetting),
    /** The space above a section heading, in pixels. */
    space: Type.Optional(
      Type.Object(
        { h2: Type.Optional(Pixels), h3: Type.Optional(Pixels) },
        { additionalProperties: false },
      ),
    ),
    /**
     * The rhythm between blocks, in pixels: between one block and the next,
     * after a heading, after the title, and before and after an object (a
     * figure, a table, code, a quotation, a callout).
     */
    flow: Type.Optional(
      Type.Object(
        {
          block: Type.Optional(Pixels),
          afterHeading: Type.Optional(Pixels),
          afterTitle: Type.Optional(Pixels),
          objectBefore: Type.Optional(Pixels),
          objectAfter: Type.Optional(Pixels),
        },
        { additionalProperties: false },
      ),
    ),
    /** The one label above a title. */
    eyebrow: Type.Optional(
      Type.Object(
        { size: Pixels, weight: Type.Optional(Weight), tracking: Type.Optional(Tracking) },
        { additionalProperties: false },
      ),
    ),
    /** Table cells, in pixels, with a unitless line height. */
    table: Type.Optional(
      Type.Object(
        { size: Pixels, leading: Type.Optional(Leading) },
        { additionalProperties: false },
      ),
    ),
    /** Code in a block, in pixels. */
    code: Type.Optional(Type.Object({ size: Pixels }, { additionalProperties: false })),
  },
  { additionalProperties: false },
)

/**
 * How a link in running text is drawn. The survey's finding is that the best
 * sites keep link *text* calm and put the signal in the underline; a theme
 * says which ink the text takes, what colour the underline is, and how thick
 * and how far below the baseline it sits, at rest and on hover.
 */
const LinkSetting = Type.Object(
  {
    text: literalUnion(['ink', 'accent'] as const),
    underline: literalUnion(['quiet', 'accent', 'current'] as const),
    /** Underline thickness in pixels. */
    thickness: Type.Optional(Type.Number({ minimum: 0.5, maximum: 4 })),
    hoverThickness: Type.Optional(Type.Number({ minimum: 0.5, maximum: 4 })),
    /** Underline offset in pixels. */
    offset: Type.Optional(Type.Number({ minimum: 0, maximum: 8 })),
  },
  { additionalProperties: false },
)

const TypePairing = Type.Object(
  {
    display: FaceRef,
    reading: FaceRef,
    interface: FaceRef,
    mono: FaceRef,
    scale: Type.Optional(ReadingScale),
    links: Type.Optional(LinkSetting),
  },
  { additionalProperties: false },
)

/** The bounded set of signature variants; each is a real component variant. */
const Variants = Type.Object(
  {
    comments: literalUnion(['sidenotes', 'panel'] as const),
    history: literalUnion(['timeline', 'menu'] as const),
    navigation: literalUnion(['tabs', 'tree'] as const),
    header: literalUnion(['readout', 'breadcrumb'] as const),
    rules: literalUnion(['double', 'hairline', 'cards', 'plain'] as const),
    /**
     * Where the reading column sits: centred in the page, or flush beside the
     * navigation with wide blocks breaking out to the right only
     * (`data-align` in `layout.css`). Optional because every document saved
     * before it existed reads as `centre` (AGENTS.md rule 17).
     */
    align: Type.Optional(literalUnion(['centre', 'start'] as const)),
  },
  { additionalProperties: false },
)

const Shape = Type.Object(
  {
    radiusStep: Type.Integer({ minimum: 0, maximum: 4 }),
    density: literalUnion(['comfortable', 'compact'] as const),
  },
  { additionalProperties: false },
)

const CollectionSeed = Type.Object(
  { hue: Hue, chroma: Type.Number({ minimum: 0, maximum: 0.37 }) },
  { additionalProperties: false },
)

/**
 * A tenant label (ADR-037): the name a document writes (`:acme[Acme]`)
 * and a drawing's class uses, what settings call it, and a colour seed. The
 * seed is a hue and an optional chroma, exactly like a status override: the
 * generator settles the label's ink, fill and stroke against the contrast
 * floors in both schemes, so a tenant cannot state an unreadable label.
 */
const LabelSeed = Type.Object(
  {
    name: Type.String({ pattern: LABEL_NAME_PATTERN }),
    title: Type.String({ minLength: 1, maxLength: 60 }),
    hue: Hue,
    chroma: Type.Optional(Type.Number({ minimum: 0, maximum: 0.37 })),
    /**
     * The emoji the label's pill leads with in place of its colour dot
     * (ADR-038): a custom emoji's name or one of GitHub's. Absent, the pill
     * leads with the organisation's custom emoji of the label's own name
     * when there is one. Optional, so every label saved before it is
     * unchanged (AGENTS.md rule 17).
     */
    emoji: Type.Optional(Type.String({ pattern: EMOJI_NAME_PATTERN })),
  },
  { additionalProperties: false },
)

/** Layer 2: a tenant may set any individual generated token, not only the seeds. */
const TokenOverrideMap = Type.Partial(
  Type.Record(literalUnion(TOKEN_NAMES), Type.String({ minLength: 1 })),
)

const Overrides = Type.Object(
  {
    shared: Type.Optional(TokenOverrideMap),
    light: Type.Optional(TokenOverrideMap),
    dark: Type.Optional(TokenOverrideMap),
  },
  { additionalProperties: false },
)

export const ThemeDocumentSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$' }),
    name: Type.String({ minLength: 1, maxLength: 80 }),
    base: Type.Optional(literalUnion(BUILTIN_THEME_IDS)),
    seeds: Seeds,
    type: TypePairing,
    variants: Variants,
    shape: Shape,
    collections: Type.Optional(Type.Record(Type.String({ minLength: 1 }), CollectionSeed)),
    /** Optional because every theme saved before ADR-037 has none (AGENTS.md rule 17). */
    labels: Type.Optional(Type.Array(LabelSeed, { maxItems: MAX_LABELS })),
    levers: Type.Array(literalUnion(LEVER_IDS), { minItems: 1, uniqueItems: true }),
    overrides: Type.Optional(Overrides),
    /**
     * Doctor warnings the tenant has looked at and accepted as part of the
     * brand, by rule id. The doctor still measures each one and reports it
     * as accepted rather than as a warning to act on.
     */
    acknowledged: Type.Optional(
      Type.Array(Type.String({ pattern: '^[a-z]+(?:-[a-z]+)*/[a-z]+(?:-[a-z]+)*$' }), {
        uniqueItems: true,
        maxItems: 64,
      }),
    ),
  },
  { additionalProperties: false, $id: `urn:${BRAND.slug}:schema:theme-document` },
)

export type ThemeDocument = Static<typeof ThemeDocumentSchema>
export type FaceReference = Static<typeof FaceRef>
export type ToneSeedValue = Static<typeof ToneSeed>
export type NeutralStepsValue = Static<typeof NeutralSteps>
export type AccentSeedValue = Static<typeof AccentSeed>
export type ThemeVariants = Static<typeof Variants>
export type ThemeShape = Static<typeof Shape>
export type ReadingScaleValue = Static<typeof ReadingScale>
export type HeadingSettingValue = Static<typeof HeadingSetting>
export type LinkSettingValue = Static<typeof LinkSetting>
export type CollectionSeedValue = Static<typeof CollectionSeed>
export type LabelSeedValue = Static<typeof LabelSeed>
