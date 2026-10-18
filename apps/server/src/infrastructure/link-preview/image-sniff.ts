/**
 * What an image really is, from its first bytes (ADR-042).
 *
 * A `Content-Type` header is the sender's claim, and a file extension is a
 * guess, so neither decides anything. The bytes decide, and only four formats
 * are accepted: PNG, JPEG, WebP and GIF. SVG is refused outright. It is a
 * document that can carry script, and "an image" is not what it is. ICO and
 * everything else are refused because there is no reason to decode them.
 */

export type SniffedImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (startsWith(bytes, PNG)) return 'image/png'
  if (startsWith(bytes, JPEG)) return 'image/jpeg'
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return 'image/gif'
  // WebP is a RIFF container: "RIFF", a four-byte size, then "WEBP".
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp'
  return null
}
