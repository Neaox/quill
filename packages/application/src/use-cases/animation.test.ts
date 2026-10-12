import { describe, expect, it } from 'vitest'

import { concatChunks } from '../ports/blob-store.ts'
import { imageFixture } from '../test-support/image-fixtures.ts'
import { animationOf, boundLoops, MAX_PLAYS } from './animation.ts'
import { crc32 } from './image-container.ts'

/** The blocks of a GIF after its colour table, by kind. */
function gifBlocks(file: Uint8Array): string[] {
  const blocks: string[] = []
  let offset = 13
  const flags = file[10] ?? 0
  if (flags & 0x80) offset += 3 * (2 << (flags & 7))
  const subBlocks = (): void => {
    for (;;) {
      const size = file[offset] ?? 0
      offset += 1 + size
      if (size === 0) return
    }
  }
  while (offset < file.length) {
    const introducer = file[offset]
    if (introducer === 0x3b) {
      blocks.push('trailer')
      break
    }
    if (introducer === 0x2c) {
      blocks.push('image')
      const imageFlags = file[offset + 9] ?? 0
      offset += 10
      if (imageFlags & 0x80) offset += 3 * (2 << (imageFlags & 7))
      offset += 1
      subBlocks()
      continue
    }
    const label = file[offset + 1]
    blocks.push(label === 0xf9 ? 'graphic-control' : `extension:${String(label)}`)
    offset += 2
    subBlocks()
  }
  return blocks
}

/** The chunk types of a PNG, in order. */
function pngChunks(file: Uint8Array): string[] {
  const types: string[] = []
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  for (let offset = 8; offset + 8 <= file.length;) {
    const length = view.getUint32(offset)
    types.push(new TextDecoder().decode(file.subarray(offset + 4, offset + 8)))
    offset += 12 + length
  }
  return types
}

/** An ISO box: its size, its type, its payload. */
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concatChunks(payload)
  const out = new Uint8Array(8 + body.length)
  new DataView(out.buffer).setUint32(0, out.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(body, 8)
  return out
}

function uint32s(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => {
    view.setUint32(index * 4, value)
  })
  return out
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value)

/** The boxes an AVIF image sequence states its length and frames in, and nothing else. */
function avifSequence({
  frames,
  milliseconds,
  extra = [],
}: {
  readonly frames: number
  readonly milliseconds: number
  readonly extra?: readonly Uint8Array[]
}): Uint8Array {
  return concatChunks([
    box('ftyp', text('avis'), uint32s(0), text('avismsf1')),
    box(
      'moov',
      // mvhd, version 0: flags, two times, the timescale and the duration.
      box('mvhd', uint32s(0, 0, 0, 1000, milliseconds)),
      box('trak', box('mdia', box('minf', box('stbl', box('stsz', uint32s(0, 0, frames)))))),
      ...extra,
    ),
  ])
}

describe('an animated emoji', () => {
  it('is a still for a picture that does not move', () => {
    expect(animationOf('image/gif', imageFixture('plain.gif'))).toEqual({ kind: 'still' })
    expect(animationOf('image/png', imageFixture('plain.png'))).toEqual({ kind: 'still' })
    expect(animationOf('image/webp', imageFixture('plain.webp'))).toEqual({ kind: 'still' })
    expect(animationOf('image/avif', imageFixture('plain.avif'))).toEqual({ kind: 'still' })
    expect(animationOf('image/jpeg', imageFixture('plain.jpg'))).toEqual({ kind: 'still' })
  })

  it('counts a GIF’s frames and its time, and cuts its first frame as the still', () => {
    const animation = animationOf('image/gif', imageFixture('animated.gif'))
    if (animation.kind !== 'animated') throw new Error(animation.kind)
    expect(animation).toMatchObject({ frames: 2, milliseconds: 200 })
    if (animation.still === undefined) throw new Error('no still')

    expect(gifBlocks(animation.still)).toEqual(['graphic-control', 'image', 'trailer'])
    // The same header, screen and palette: the frame is drawn as it was.
    const original = imageFixture('animated.gif')
    expect(animation.still.subarray(0, 13)).toEqual(original.subarray(0, 13))
  })

  it('times a GIF frame of no delay as browsers draw it, a tenth of a second', () => {
    const fast = Uint8Array.from(imageFixture('animated.gif'))
    // Every graphic control's delay set to zero.
    for (let at = fast.indexOf(0xf9); at !== -1; at = fast.indexOf(0xf9, at + 1)) {
      if (fast[at - 1] === 0x21) fast.set([0, 0], at + 3)
    }
    expect(animationOf('image/gif', fast)).toMatchObject({ frames: 2, milliseconds: 200 })
  })

  it('counts an animated PNG’s frames and time, and keeps its default image as the still', () => {
    const animation = animationOf('image/png', imageFixture('animated.png'))
    if (animation.kind !== 'animated') throw new Error(animation.kind)
    expect(animation).toMatchObject({ frames: 2, milliseconds: 200 })
    if (animation.still === undefined) throw new Error('no still')

    const chunks = pngChunks(animation.still)
    expect(chunks).toContain('IDAT')
    expect(chunks).not.toContain('acTL')
    expect(chunks).not.toContain('fcTL')
    expect(chunks).not.toContain('fdAT')
    expect(chunks.at(-1)).toBe('IEND')
  })

  it('counts an animated WebP’s frames and time, with no still until the image pipeline', () => {
    expect(animationOf('image/webp', imageFixture('animated-exif.webp'))).toEqual({
      kind: 'animated',
      frames: 2,
      milliseconds: 200,
    })
  })

  it('reads an AVIF sequence’s frames and time from its movie, with no still', () => {
    expect(animationOf('image/avif', avifSequence({ frames: 5, milliseconds: 1200 }))).toEqual({
      kind: 'animated',
      frames: 5,
      milliseconds: 1200,
    })
  })

  it('refuses an AVIF sequence whose tracks carry metadata it cannot take out', () => {
    const tagged = avifSequence({
      frames: 5,
      milliseconds: 1200,
      extra: [box('udta', text('location'))],
    })
    expect(() => animationOf('image/avif', tagged)).toThrow(/metadata/u)
    expect(() => animationOf('image/avif', box('ftyp', text('avis'), uint32s(0)))).toThrow(/movie/u)
  })
})

/** Where a GIF's loop extension states its count, or -1 when it has none. */
function netscapeLoopAt(file: Uint8Array): number {
  const at = new TextDecoder('latin1').decode(file).indexOf('NETSCAPE2.0')
  return at === -1 ? -1 : at + 13
}

function gifLoopCount(file: Uint8Array): number | undefined {
  const at = netscapeLoopAt(file)
  return at === -1 ? undefined : (file[at] ?? 0) | ((file[at + 1] ?? 0) << 8)
}

/** A copy of the GIF fixture with its loop count set, or its loop extension taken out. */
function gifLooping(count: number | 'none'): Uint8Array {
  const gif = Uint8Array.from(imageFixture('animated.gif'))
  const at = netscapeLoopAt(gif)
  if (count !== 'none') {
    gif.set([count & 0xff, count >> 8], at)
    return gif
  }
  // The extension, 19 bytes: introducer, label, the identifier's block of
  // eleven, the loop block of three, and the terminator.
  const start = at - 16
  return concatChunks([gif.subarray(0, start), gif.subarray(start + 19)])
}

/** The PNG fixture's `acTL` chunk: where it starts, so a test can read or rewrite it. */
function acTLAt(file: Uint8Array): number {
  return new TextDecoder('latin1').decode(file).indexOf('acTL') - 4
}

function pngPlays(file: Uint8Array): number {
  return new DataView(file.buffer, file.byteOffset).getUint32(acTLAt(file) + 12)
}

function pngWithPlays(plays: number): Uint8Array {
  const png = Uint8Array.from(imageFixture('animated.png'))
  const at = acTLAt(png)
  const view = new DataView(png.buffer)
  view.setUint32(at + 12, plays)
  view.setUint32(at + 16, crc32(png.subarray(at + 4, at + 16)))
  return png
}

/** Whether every chunk of a PNG carries the CRC its contents give. */
function crcsHold(file: Uint8Array): boolean {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  for (let offset = 8; offset + 8 <= file.length;) {
    const length = view.getUint32(offset)
    const stated = view.getUint32(offset + 8 + length)
    if (crc32(file.subarray(offset + 4, offset + 8 + length)) !== stated) return false
    offset += 12 + length
  }
  return true
}

describe('an animation bounded in the file (ADR-047)', () => {
  it('plays three times at most, however the file was written', () => {
    expect(MAX_PLAYS).toBe(3)
  })

  it('rewrites a GIF that loops forever to repeat twice, three plays in all', () => {
    const original = imageFixture('animated.gif')
    expect(gifLoopCount(original)).toBe(0)
    const bounded = boundLoops('image/gif', original)
    expect(bounded?.plays).toBe(3)
    if (bounded === undefined) throw new Error('not bounded')
    // A GIF's count is of repeats after the first play, in every browser.
    expect(gifLoopCount(bounded.bytes)).toBe(2)
    expect(gifBlocks(bounded.bytes)).toEqual(gifBlocks(original))
    expect(bounded.bytes.length).toBe(original.length)
    expect(animationOf('image/gif', bounded.bytes)).toMatchObject({ frames: 2, milliseconds: 200 })
    // The original is left as it came.
    expect(gifLoopCount(original)).toBe(0)
  })

  it('bounds a GIF that repeats too often, and leaves one that stops soon enough', () => {
    expect(gifLoopCount(boundLoops('image/gif', gifLooping(10))?.bytes ?? new Uint8Array())).toBe(2)
    const once = gifLooping(1)
    expect(boundLoops('image/gif', once)).toEqual({ bytes: once, plays: 2 })
  })

  it('states the count in a GIF with no loop extension, whose meaning browsers disagree on', () => {
    const silent = gifLooping('none')
    expect(gifLoopCount(silent)).toBeUndefined()
    expect(animationOf('image/gif', silent)).toMatchObject({ frames: 2 })
    const bounded = boundLoops('image/gif', silent)
    expect(bounded?.plays).toBe(3)
    if (bounded === undefined) throw new Error('not bounded')
    expect(gifLoopCount(bounded.bytes)).toBe(2)
    // Where an encoder puts it: first, straight after the screen and its palette.
    expect(gifBlocks(bounded.bytes)[0]).toBe('extension:255')
    expect(animationOf('image/gif', bounded.bytes)).toMatchObject({ frames: 2, milliseconds: 200 })
  })

  it('sets an animated PNG that loops forever to three plays, with a CRC that holds', () => {
    const original = imageFixture('animated.png')
    expect(pngPlays(original)).toBe(0)
    const bounded = boundLoops('image/png', original)
    expect(bounded?.plays).toBe(3)
    if (bounded === undefined) throw new Error('not bounded')
    expect(pngPlays(bounded.bytes)).toBe(3)
    expect(crcsHold(bounded.bytes)).toBe(true)
    expect(pngChunks(bounded.bytes)).toEqual(pngChunks(original))
    expect(pngPlays(original)).toBe(0)
  })

  it('bounds an animated PNG that plays too often, and leaves one that stops soon enough', () => {
    expect(pngPlays(boundLoops('image/png', pngWithPlays(9))?.bytes ?? new Uint8Array())).toBe(3)
    const twice = pngWithPlays(2)
    expect(boundLoops('image/png', twice)).toEqual({ bytes: twice, plays: 2 })
  })

  it('leaves alone a picture that does not move, and the formats the pipeline will bound', () => {
    expect(boundLoops('image/gif', imageFixture('plain.gif'))).toBeUndefined()
    expect(boundLoops('image/png', imageFixture('plain.png'))).toBeUndefined()
    expect(boundLoops('image/jpeg', imageFixture('plain.jpg'))).toBeUndefined()
    expect(boundLoops('image/webp', imageFixture('animated-exif.webp'))).toBeUndefined()
    expect(
      boundLoops('image/avif', avifSequence({ frames: 5, milliseconds: 1200 })),
    ).toBeUndefined()
  })

  it('refuses a GIF that ends inside a block', () => {
    const original = imageFixture('animated.gif')
    expect(() => boundLoops('image/gif', original.subarray(0, original.length - 6))).toThrow(
      /ends inside a block/u,
    )
  })
})
