import { type Static, Type } from '@sinclair/typebox'

import { EMOJI_NAME_PATTERN } from '@quill/theme'
import type { ThemeDocument } from '@quill/theme'

/**
 * The organisation's own emoji (ADR-038): `:acme:` drawn as an image the
 * organisation uploaded — its logo, a partner's, a team's mascot.
 *
 * They are the organisation's settings and not its theme's. A theme is
 * identity — colours, faces, shape — and choosing another built-in replaces
 * it whole; an emoji is vocabulary documents are written in, and must not
 * disappear because somebody tried a different accent. The bytes are a blob,
 * addressed by their hash; the settings file holds the name, the hash, the
 * type and the size, and never the bytes (ADR-034).
 */

/**
 * The image types an emoji may be: the rasters every current browser draws in
 * `<img>`, and SVG, which is only ever shown as `<img>` — so an organisation's
 * logo can be the vector its brand guide ships.
 */
export const EMOJI_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
] as const

export type EmojiMediaType = (typeof EMOJI_MEDIA_TYPES)[number]

/** The extension each type is served under, so a URL says what it is. */
const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
} as const satisfies Record<EmojiMediaType, string>

/** Enough for a palette of logos; past it, emoji stop being something anyone remembers. */
export const MAX_CUSTOM_EMOJI = 100

/** An emoji is drawn at text size; anything this large is a picture, not an emoji. */
export const MAX_EMOJI_PIXELS = 1024

/** An emoji image larger than this is not one. */
export const MAX_EMOJI_BYTES = 256 * 1024

/** ADR-047's animation limits: past these an animation is a clip, not an emoji. */
export const MAX_EMOJI_FRAMES = 300
export const MAX_EMOJI_MILLISECONDS = 10_000

/** Alternative text is a phrase, not a paragraph. */
export const MAX_EMOJI_DESCRIPTION = 120

const Pixels = Type.Integer({ minimum: 1, maximum: MAX_EMOJI_PIXELS })

const Hash = Type.String({ pattern: '^[0-9a-f]{64}$' })

/**
 * The types an animation's still can be made for (`animation.ts`). A
 * still is the animation's first frame in the animation's own type.
 */
const TYPES_WITH_STILLS: ReadonlySet<EmojiMediaType> = new Set(['image/gif', 'image/png'])

/**
 * The types a still may be stored as: the animation's own, cut at upload, or
 * a PNG, which is what the uploader's browser cuts a chosen poster frame as.
 */
const STILL_TYPES = ['image/gif', 'image/png'] as const

export const CustomEmojiSchema = Type.Object(
  {
    /** Written `:name:`; the shape of a label's name, with `_`. */
    name: Type.String({ pattern: EMOJI_NAME_PATTERN }),
    /** Lower-case hex SHA-256 of the image, the blob store's address for it. */
    hash: Hash,
    mediaType: Type.Union(EMOJI_MEDIA_TYPES.map((type) => Type.Literal(type))),
    /**
     * For an animated GIF or PNG, the hash of its first frame as a still of
     * the same type, shown to a reader who asks for less motion
     * (`prefers-reduced-motion`). Absent for a picture that does not move.
     */
    still: Type.Optional(Hash),
    /**
     * The still's type, when it is not the animation's own: a poster frame
     * the uploader chose is cut by their browser, as a PNG (ADR-047).
     */
    stillType: Type.Optional(Type.Union(STILL_TYPES.map((type) => Type.Literal(type)))),
    /** Which frame the still is, counted from nought; absent for the first. */
    poster: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_EMOJI_FRAMES - 1 })),
    /**
     * An animation's frame count and the length of one loop, read at upload,
     * so the reader's enhancer can time a brief play without decoding it
     * (ADR-047). Optional: an emoji saved before they were recorded plays
     * for the enhancer's longest brief play instead.
     */
    frames: Type.Optional(Type.Integer({ minimum: 2, maximum: MAX_EMOJI_FRAMES })),
    milliseconds: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_EMOJI_MILLISECONDS })),
    /**
     * How many times the served file plays, written into it at upload
     * (ADR-047, "Bounded in the file too"), so it stops with no script running.
     */
    // At most `animation.ts`'s `MAX_PLAYS`.
    plays: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
    /**
     * The upload as it came, metadata stripped, when `hash` is a copy whose
     * play count was changed. Kept as the source; never served.
     */
    original: Type.Optional(Hash),
    /**
     * What the picture shows, in words: its alternative text, which a screen
     * reader says in place of the picture and which stands in for it when it
     * does not load. Optional so every file written before it reads as it did;
     * left out, the renderer says the emoji's name as words instead.
     */
    description: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_EMOJI_DESCRIPTION })),
    /** The image's own size, for its proportions; it is drawn at the text's height. */
    width: Pixels,
    height: Pixels,
  },
  { additionalProperties: false },
)

export type CustomEmojiEntry = Static<typeof CustomEmojiSchema>

/** Where emoji images are served: public and same-origin, like the theme's fonts. */
export const EMOJI_URL_PREFIX = '/api/emoji/'

/**
 * The file an emoji is served as: its name, sixteen hex of its hash and its
 * extension — `acme.0123456789abcdef.svg` — so the address changes
 * whenever the image does and can be cached as immutable.
 */
export function emojiFileName(entry: CustomEmojiEntry): string {
  return fileName(entry.name, entry.hash, entry.mediaType)
}

export function emojiUrl(entry: CustomEmojiEntry): string {
  return `${EMOJI_URL_PREFIX}${emojiFileName(entry)}`
}

function fileName(name: string, hash: string, mediaType: EmojiMediaType): string {
  return `${name}.${hash.slice(0, 16)}.${EXTENSIONS[mediaType]}`
}

/** One image a saved emoji is drawn with: its picture, or its animation's still. */
export interface EmojiImageFile {
  readonly hash: string
  readonly mediaType: EmojiMediaType
}

/** Every file an emoji is served as, by file name. */
function* emojiFiles(entry: CustomEmojiEntry): Generator<readonly [string, EmojiImageFile]> {
  yield [emojiFileName(entry), { hash: entry.hash, mediaType: entry.mediaType }]
  const stillType = stillMediaType(entry)
  if (entry.still !== undefined && stillType !== undefined) {
    yield [
      fileName(entry.name, entry.still, stillType),
      { hash: entry.still, mediaType: stillType },
    ]
  }
}

function stillMediaType(entry: CustomEmojiEntry): EmojiMediaType | undefined {
  if (!TYPES_WITH_STILLS.has(entry.mediaType)) return undefined
  return entry.stillType ?? entry.mediaType
}

/** The image a served file name names, or undefined: only listed emoji are ever served. */
export function emojiForFile(
  emoji: readonly CustomEmojiEntry[] | undefined,
  file: string,
): EmojiImageFile | undefined {
  for (const entry of emoji ?? []) {
    for (const [name, image] of emojiFiles(entry)) if (name === file) return image
  }
  return undefined
}

/** Where an animation's still is served, when it has one. */
function stillUrl(entry: CustomEmojiEntry): string | undefined {
  const stillType = stillMediaType(entry)
  return entry.still === undefined || stillType === undefined
    ? undefined
    : `${EMOJI_URL_PREFIX}${fileName(entry.name, entry.still, stillType)}`
}

/** An emoji as the renderer is given it (`@quill/markdown`'s `CustomEmoji`). */
export interface RenderedEmoji {
  readonly src: string
  /** An animation's still, for a reader who asks for less motion. */
  readonly still?: string
  /** An animation's frame count and loop length, for the reader's brief play (ADR-047). */
  readonly frames?: number
  readonly milliseconds?: number
  /** What the picture shows, in words: its alternative text. */
  readonly description?: string
  readonly width: number
  readonly height: number
}

/** The organisation's emoji by name, ready to draw. */
export function customEmojiByName(
  emoji: readonly CustomEmojiEntry[] | undefined,
): ReadonlyMap<string, RenderedEmoji> {
  return new Map(
    (emoji ?? []).map((entry) => {
      const still = stillUrl(entry)
      return [
        entry.name,
        {
          src: emojiUrl(entry),
          ...(still === undefined ? {} : { still }),
          ...(entry.frames === undefined ? {} : { frames: entry.frames }),
          ...(entry.milliseconds === undefined ? {} : { milliseconds: entry.milliseconds }),
          ...(entry.description === undefined ? {} : { description: entry.description }),
          width: entry.width,
          height: entry.height,
        },
      ]
    }),
  )
}

/**
 * The emoji each label's pill leads with, by label name (ADR-038): the one
 * the label names, or else the organisation's own emoji of the label's name.
 * A label with neither keeps its colour dot.
 */
export function labelEmoji(
  theme: ThemeDocument,
  emoji: readonly CustomEmojiEntry[] | undefined,
): ReadonlyMap<string, string> {
  const custom = new Set((emoji ?? []).map((entry) => entry.name))
  return new Map(
    (theme.labels ?? []).flatMap((label) => {
      const lead = label.emoji ?? (custom.has(label.name) ? label.name : undefined)
      return lead === undefined ? [] : [[label.name, lead] as const]
    }),
  )
}

/** A problem with the emoji list the schema cannot express: two emoji of one name. */
export function duplicateEmojiNames(
  emoji: readonly CustomEmojiEntry[] | undefined,
): readonly { readonly index: number; readonly name: string }[] {
  return (emoji ?? []).flatMap(({ name }, index, all) =>
    all.findIndex((other) => other.name === name) === index ? [] : [{ index, name }],
  )
}
