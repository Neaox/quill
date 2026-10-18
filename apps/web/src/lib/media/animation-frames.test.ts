import { describe, expect, it, vi } from 'vitest'

import { readAnimationFrames, type FramePlatform } from './animation-frames.ts'

interface FakeFrame {
  readonly index: number
  readonly close: () => void
}

/** An ImageDecoder over a picture of `count` frames, recording what it was asked. */
function fakeDecoder(count: number, supported = true) {
  const closed = vi.fn<() => void>()
  const frameClosed = vi.fn<() => void>()
  const types: string[] = []
  class FakeImageDecoder {
    static isTypeSupported(type: string): Promise<boolean> {
      types.push(type)
      return Promise.resolve(supported)
    }
    readonly completed = Promise.resolve()
    readonly tracks = {
      ready: Promise.resolve(),
      selectedTrack: { frameCount: count },
    }
    decode({ frameIndex }: { frameIndex: number }): Promise<{ image: FakeFrame }> {
      return Promise.resolve({ image: { index: frameIndex, close: frameClosed } })
    }
    close(): void {
      closed()
    }
  }
  const platform = {
    ImageDecoder: FakeImageDecoder as unknown as typeof ImageDecoder,
    toPng: (frame: VideoFrame) =>
      Promise.resolve(
        new Blob([`frame ${String((frame as unknown as FakeFrame).index)}`], { type: 'image/png' }),
      ),
  } satisfies FramePlatform
  return { platform, closed, frameClosed, types }
}

const gif = new File(['GIF89a'], 'party.gif', { type: 'image/gif' })

describe('reading an animation’s frames in the browser (ADR-047)', () => {
  it('counts a GIF’s frames and draws any of them as a PNG, closing each frame', async () => {
    const { platform, closed, frameClosed } = fakeDecoder(12)
    const frames = await readAnimationFrames(gif, platform)
    if (frames === undefined) throw new Error('no frames')

    expect(frames.count).toBe(12)
    const poster = await frames.frame(4)
    expect(poster.type).toBe('image/png')
    expect(await poster.text()).toBe('frame 4')
    expect(frameClosed).toHaveBeenCalledOnce()
    frames.close()
    expect(closed).toHaveBeenCalledOnce()
  })

  it('reads an animated PNG the same way', async () => {
    const { platform, types } = fakeDecoder(3)
    const png = new File(['png'], 'spin.png', { type: 'image/png' })
    expect((await readAnimationFrames(png, platform))?.count).toBe(3)
    expect(types).toEqual(['image/png'])
  })

  it('has nothing to offer for a picture that does not move, and lets the decoder go', async () => {
    const { platform, closed } = fakeDecoder(1)
    expect(await readAnimationFrames(gif, platform)).toBeUndefined()
    expect(closed).toHaveBeenCalledOnce()
  })

  it('leaves WebP and AVIF to the image pipeline, whose stills are not cut here', async () => {
    const { platform, types } = fakeDecoder(12)
    const webp = new File(['RIFF'], 'spin.webp', { type: 'image/webp' })
    expect(await readAnimationFrames(webp, platform)).toBeUndefined()
    expect(types).toEqual([])
  })

  it('has nothing to offer where the browser cannot decode the type, or has no decoder', async () => {
    expect(await readAnimationFrames(gif, fakeDecoder(12, false).platform)).toBeUndefined()
    const { toPng } = fakeDecoder(12).platform
    expect(await readAnimationFrames(gif, { ImageDecoder: undefined, toPng })).toBeUndefined()
  })

  it('has nothing to offer for a file the decoder refuses', async () => {
    const { platform } = fakeDecoder(12)
    class Refusing extends (platform.ImageDecoder as unknown as new () => object) {
      constructor() {
        super()
        throw new DOMException('Unsupported', 'NotSupportedError')
      }
    }
    const refusing = {
      ...platform,
      ImageDecoder: Object.assign(Refusing, {
        isTypeSupported: () => Promise.resolve(true),
      }) as unknown as typeof ImageDecoder,
    }
    expect(await readAnimationFrames(gif, refusing)).toBeUndefined()
  })
})
