/**
 * What an uploaded file actually is, decided from its bytes (ADR-011:
 * "content type determined by sniffing not by the client's header").
 *
 * A browser sends whatever its platform guessed from the file extension, and
 * an attacker sends whatever they like, so the declared type is a claim to be
 * checked rather than a fact to be stored. Every function here is pure and
 * takes only the first bytes of a file, which is all any of these formats
 * needs: the platform reads one chunk, asks, and refuses before the rest of
 * the upload is worth receiving.
 */

/**
 * The raster formats an attachment may be. Each is a container the platform
 * can walk without decoding it, which is what lets `image-metadata.ts` strip
 * what a picture carries besides its pixels (ADR-011, amendment of
 * 2026-09-13); a format that cannot be walked that way does not belong here.
 */
export const IMAGE_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
] as const

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number]

/** Every type an attachment may be. Anything else is refused (ADR-011). */
export const ALLOWED_MEDIA_TYPES = [...IMAGE_MEDIA_TYPES, 'application/pdf'] as const

export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number]

const IMAGES = new Set<string>(IMAGE_MEDIA_TYPES)
const ALLOWED = new Set<string>(ALLOWED_MEDIA_TYPES)

export function isImageMediaType(type: string): type is ImageMediaType {
  return IMAGES.has(type)
}

export function isAllowedMediaType(type: string): type is AllowedMediaType {
  return ALLOWED.has(type)
}

/** The types served inline; everything else is a download (ADR-011 "safe serving"). */
export function isInlineMediaType(type: string): boolean {
  return type.startsWith('image/')
}

/**
 * How many bytes the sniffers below need at most.
 *
 * The longest signature is the ISO base media box a `.avif` opens with: four
 * length bytes, `ftyp`, the major brand, four version bytes, and then the
 * compatible brands, of which the first two are enough to recognise the file.
 * SVG needs more, because an SVG may open with an XML declaration, a comment,
 * or a doctype before its root element, so the prologue is given room.
 */
export const SNIFF_BYTES = 512

/**
 * A media type read straight from the bytes, or `null` for anything this
 * platform does not accept — which includes every type it simply does not
 * recognise. `svg` is named rather than dropped so an upload can be refused
 * with the reason rather than with "not an image", which is a confusing thing
 * to be told about a picture.
 */
export type SniffedMediaType = AllowedMediaType | 'image/svg+xml' | null

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]

/** `avis` is the image-sequence brand; both are decoded by the same `<img>`. */
const AVIF_BRANDS = new Set(['avif', 'avis'])

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

/** The ASCII in a fixed byte range, for the four-character tags these container formats use. */
function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return ''
  return String.fromCharCode(...bytes.subarray(start, end))
}

function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, PNG)
}

/**
 * The three bytes every JPEG variant opens with: `FF D8` is start-of-image and
 * the third byte begins the first marker, which JFIF, Exif, and a bare
 * quantisation table all have.
 */
function isJpeg(bytes: Uint8Array): boolean {
  return startsWith(bytes, JPEG)
}

function isGif(bytes: Uint8Array): boolean {
  const header = ascii(bytes, 0, 6)
  return header === 'GIF87a' || header === 'GIF89a'
}

/** A RIFF container whose form type is `WEBP`; the four bytes between are its length. */
function isWebp(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP'
}

/**
 * An ISO base media file whose major brand, or one of its compatible brands,
 * is an AVIF brand. The compatible-brand list matters: encoders routinely
 * write a major brand of `mif1` and declare `avif` behind it.
 */
function isAvif(bytes: Uint8Array): boolean {
  if (ascii(bytes, 4, 8) !== 'ftyp') return false
  if (AVIF_BRANDS.has(ascii(bytes, 8, 12))) return true
  // Compatible brands run from byte 16 to the end of the box; reading the
  // declared box length keeps a lie about it from reaching past the buffer.
  const boxLength = Math.min(readBoxLength(bytes), bytes.length)
  for (let offset = 16; offset + 4 <= boxLength; offset += 4) {
    if (AVIF_BRANDS.has(ascii(bytes, offset, offset + 4))) return true
  }
  return false
}

/**
 * The declared length of the opening box, big-endian in its first four bytes.
 *
 * Only ever asked of a buffer whose bytes 4..8 are already known to be `ftyp`,
 * so the four bytes it reads are always there.
 */
function readBoxLength(bytes: Uint8Array): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
}

function isPdf(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 5) === '%PDF-'
}

/** A byte-order mark, then anything XML allows before the root element. */
const SVG_PROLOGUE = /^(?:\uFEFF)?\s*(?:<\?xml[^>]*\?>\s*|<!DOCTYPE[^>]*>\s*|<!--[\s\S]*?-->\s*)*/

/**
 * Whether these bytes open an SVG.
 *
 * SVG has no magic number — it is XML — so this is the one format here
 * recognised by shape rather than by signature. It is recognised at all only
 * so the refusal can say *why*: an SVG is a document that can carry script and
 * fetch external references, which is why the renderer's sanitiser will not
 * accept one either (`packages/markdown/src/render/sanitize-schema.ts`).
 */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, SNIFF_BYTES))
  const body = head.replace(SVG_PROLOGUE, '')
  // The root element ends in whitespace, in `>`, or in the `/` of `<svg/>`;
  // requiring one of the three is what keeps `<svgx>` from reading as an SVG.
  return /^<svg[\s/>]/i.test(body)
}

/**
 * The type these bytes are, whatever the uploader said they were.
 *
 * The binary signatures are tried first and the text shape last, so a file
 * that is both — which none of these formats can be — is never read as the
 * weaker evidence.
 */
export function sniffMediaType(bytes: Uint8Array): SniffedMediaType {
  if (isPng(bytes)) return 'image/png'
  if (isJpeg(bytes)) return 'image/jpeg'
  if (isGif(bytes)) return 'image/gif'
  if (isWebp(bytes)) return 'image/webp'
  if (isAvif(bytes)) return 'image/avif'
  if (isPdf(bytes)) return 'application/pdf'
  if (looksLikeSvg(bytes)) return 'image/svg+xml'
  return null
}

/**
 * A declared content type reduced to its essence: lower-cased, parameters
 * (`; charset=…`, `; boundary=…`) dropped, surrounding space removed. What is
 * left is the only part that can be compared with what the bytes say.
 */
export function normaliseMediaType(declared: string): string {
  const [essence = ''] = declared.split(';')
  return essence.trim().toLowerCase()
}
