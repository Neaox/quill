import { type Static, Type } from '@sinclair/typebox'

import { BRAND } from '@quill/brand'
import { TOKEN_NAMES } from '../tokens.ts'
import { CURATED_FACE_IDS } from './faces.ts'

/** ADR-028, layer 1: a theme is a declarative document, never CSS. */

export const BUILTIN_THEME_IDS = ['press', 'instrument', 'atelier'] as const
export type BuiltinThemeId = (typeof BUILTIN_THEME_IDS)[number]

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

const ToneSeed = Type.Object(
  {
    hue: Hue,
    /** Neutrals are tinted, not coloured: the area effect caps them hard. */
    chroma: Type.Number({ minimum: 0, maximum: 0.04 }),
  },
  { additionalProperties: false },
)

const AccentSeed = Type.Object(
  {
    hue: Hue,
    chroma: Type.Number({ minimum: 0, maximum: 0.37 }),
    /** The tenant's exact lightness, kept for the mark where it is unsafe for text. */
    lightness: Type.Optional(Lightness),
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

const TypePairing = Type.Object(
  {
    display: FaceRef,
    reading: FaceRef,
    interface: FaceRef,
    mono: FaceRef,
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
    rules: literalUnion(['double', 'hairline', 'cards'] as const),
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
    levers: Type.Array(literalUnion(LEVER_IDS), { minItems: 1, uniqueItems: true }),
    overrides: Type.Optional(Overrides),
  },
  { additionalProperties: false, $id: `urn:${BRAND.slug}:schema:theme-document` },
)

export type ThemeDocument = Static<typeof ThemeDocumentSchema>
export type FaceReference = Static<typeof FaceRef>
export type ToneSeedValue = Static<typeof ToneSeed>
export type AccentSeedValue = Static<typeof AccentSeed>
export type ThemeVariants = Static<typeof Variants>
export type ThemeShape = Static<typeof Shape>
export type CollectionSeedValue = Static<typeof CollectionSeed>
