import { describe, expect, it } from 'vitest'

import {
  ALLOWED_MEDIA_TYPES,
  isAllowedMediaType,
  isInlineMediaType,
  looksLikeSvg,
  normaliseMediaType,
  sniffMediaType,
} from './media-types.ts'

function bytes(...values: readonly (number | string)[]): Uint8Array {
  const flattened = values.flatMap((value) =>
    typeof value === 'number' ? [value] : [...value].map((character) => character.charCodeAt(0)),
  )
  return Uint8Array.from(flattened)
}

/** A four-byte big-endian length, for the ISO base media box AVIF opens with. */
function boxLength(length: number): readonly number[] {
  return [(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff]
}

describe('sniffMediaType', () => {
  it('recognises a PNG by its signature', () => {
    expect(sniffMediaType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('image/png')
  })

  it('recognises a JPEG whatever marker follows start-of-image', () => {
    expect(sniffMediaType(bytes(0xff, 0xd8, 0xff, 0xe0, 'JFIF'))).toBe('image/jpeg')
    expect(sniffMediaType(bytes(0xff, 0xd8, 0xff, 0xe1, 'Exif'))).toBe('image/jpeg')
    expect(sniffMediaType(bytes(0xff, 0xd8, 0xff, 0xdb))).toBe('image/jpeg')
  })

  it('recognises both GIF versions and nothing in between', () => {
    expect(sniffMediaType(bytes('GIF87a', 0x01))).toBe('image/gif')
    expect(sniffMediaType(bytes('GIF89a', 0x01))).toBe('image/gif')
    expect(sniffMediaType(bytes('GIF88a', 0x01))).toBeNull()
  })

  it('recognises a WebP by its RIFF form type, not by RIFF alone', () => {
    expect(sniffMediaType(bytes('RIFF', 0x10, 0x00, 0x00, 0x00, 'WEBPVP8 '))).toBe('image/webp')
    // A WAVE is a RIFF too, and is not an image.
    expect(sniffMediaType(bytes('RIFF', 0x10, 0x00, 0x00, 0x00, 'WAVEfmt '))).toBeNull()
  })

  it('recognises an AVIF from its major brand', () => {
    expect(sniffMediaType(bytes(...boxLength(20), 'ftypavif', 0x00, 0x00, 0x00, 0x00))).toBe(
      'image/avif',
    )
    expect(sniffMediaType(bytes(...boxLength(20), 'ftypavis', 0x00, 0x00, 0x00, 0x00))).toBe(
      'image/avif',
    )
  })

  it('recognises an AVIF declared behind a different major brand', () => {
    const file = bytes(...boxLength(28), 'ftypmif1', 0x00, 0x00, 0x00, 0x00, 'mif1avif')
    expect(sniffMediaType(file)).toBe('image/avif')
  })

  it('refuses an ISO base media file that is not an AVIF', () => {
    // An MP4: the same container, a brand this platform does not accept.
    const file = bytes(...boxLength(24), 'ftypisom', 0x00, 0x00, 0x00, 0x00, 'mp42')
    expect(sniffMediaType(file)).toBeNull()
  })

  it('does not read compatible brands past the box the file declares', () => {
    // The box claims to end before the `avif` that follows it, so that `avif`
    // belongs to whatever comes next and is not this file's brand.
    const file = bytes(...boxLength(16), 'ftypisom', 0x00, 0x00, 0x00, 0x00, 'avif')
    expect(sniffMediaType(file)).toBeNull()
  })

  it('recognises a PDF', () => {
    expect(sniffMediaType(bytes('%PDF-1.7\n%'))).toBe('application/pdf')
  })

  it('names an SVG rather than calling it unknown', () => {
    expect(sniffMediaType(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      'image/svg+xml',
    )
  })

  it('names an SVG hidden behind an XML prologue, a doctype, or a comment', () => {
    expect(sniffMediaType(bytes('<?xml version="1.0"?>\n<svg width="1"></svg>'))).toBe(
      'image/svg+xml',
    )
    expect(sniffMediaType(bytes('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">\n<svg/>'))).toBe(
      'image/svg+xml',
    )
    expect(sniffMediaType(bytes('<!-- drawn by hand -->\n<svg />'))).toBe('image/svg+xml')
    expect(sniffMediaType(bytes(0xef, 0xbb, 0xbf, '  <svg/>'))).toBe('image/svg+xml')
  })

  it('does not mistake other markup for an SVG', () => {
    expect(sniffMediaType(bytes('<html><body></body></html>'))).toBeNull()
    expect(sniffMediaType(bytes('<svgx/>'))).toBeNull()
  })

  it('refuses what it does not recognise, including an empty file', () => {
    expect(sniffMediaType(bytes())).toBeNull()
    expect(sniffMediaType(bytes('MZ', 0x90, 0x00))).toBeNull()
    expect(sniffMediaType(bytes(0x89, 'PN'))).toBeNull()
  })
})

describe('looksLikeSvg', () => {
  it('reads only the head of a long file', () => {
    const padded = bytes(' '.repeat(600), '<svg/>')
    expect(looksLikeSvg(padded)).toBe(false)
  })

  it('is case-insensitive about the element name', () => {
    expect(looksLikeSvg(bytes('<SVG></SVG>'))).toBe(true)
  })

  it('survives bytes that are not valid UTF-8', () => {
    expect(looksLikeSvg(bytes(0xff, 0xfe, 0x00))).toBe(false)
  })
})

describe('the allowlist', () => {
  it('accepts exactly the declared set', () => {
    for (const type of ALLOWED_MEDIA_TYPES) expect(isAllowedMediaType(type)).toBe(true)
    expect(isAllowedMediaType('image/svg+xml')).toBe(false)
    expect(isAllowedMediaType('text/html')).toBe(false)
  })

  it('serves images inline and everything else as a download', () => {
    expect(isInlineMediaType('image/png')).toBe(true)
    expect(isInlineMediaType('application/pdf')).toBe(false)
  })
})

describe('normaliseMediaType', () => {
  it('drops parameters, case, and surrounding space', () => {
    expect(normaliseMediaType('  IMAGE/PNG ')).toBe('image/png')
    expect(normaliseMediaType('image/jpeg; charset=binary')).toBe('image/jpeg')
    expect(normaliseMediaType('')).toBe('')
  })
})
