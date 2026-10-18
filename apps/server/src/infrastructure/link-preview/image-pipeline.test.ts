import { createInMemoryBlobStore } from '@quill/application/test-support'
import { EventEmitter } from 'node:events'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

import type { OpenWebReader, OpenWebResponse } from '../http/open-web-client.ts'
import { OutboundRequestError } from '../http/outbound-client.ts'
import { createImageIngestor } from './image-ingestor.ts'
import { sniffImageType } from './image-sniff.ts'
import { FAVICON_SPEC, ImageTranscodeError, THUMBNAIL_SPEC } from './image-transcoder.ts'
import type { ImageTranscoder } from './image-transcoder.ts'
import { createIsolatedTranscoder, workerSpawnOptions } from './isolated-transcoder.ts'
import type { WorkerProcess } from './isolated-transcoder.ts'
import { createSharpTranscoder } from './sharp-transcoder.ts'

async function picture(
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' | 'gif',
  options: { exif?: boolean } = {},
): Promise<Uint8Array> {
  const base = sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
  const withMetadata =
    options.exif === true ? base.withExif({ IFD0: { Copyright: 'someone' } }) : base
  return new Uint8Array(await withMetadata.toFormat(format).toBuffer())
}

const text = (value: string) => new TextEncoder().encode(value)

async function describeImage(bytes: Uint8Array) {
  const metadata = await sharp(bytes).metadata()
  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    hasExif: metadata.exif !== undefined,
  }
}

describe('sniffImageType', () => {
  it('recognises the four accepted formats from their bytes', async () => {
    expect(sniffImageType(await picture(8, 8, 'png'))).toBe('image/png')
    expect(sniffImageType(await picture(8, 8, 'jpeg'))).toBe('image/jpeg')
    expect(sniffImageType(await picture(8, 8, 'webp'))).toBe('image/webp')
    expect(sniffImageType(await picture(8, 8, 'gif'))).toBe('image/gif')
  })

  it('refuses SVG, HTML, ICO, PDF, an empty body and a truncated signature', () => {
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(sniffImageType(text('<!doctype html><html>'))).toBeNull()
    expect(sniffImageType(Uint8Array.from([0, 0, 1, 0, 1, 0]))).toBeNull()
    expect(sniffImageType(text('%PDF-1.7'))).toBeNull()
    expect(sniffImageType(new Uint8Array(0))).toBeNull()
    expect(sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e]))).toBeNull()
  })

  it('does not take a RIFF container that is not WebP for one', () => {
    const wave = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WAVEfmt ')
    expect(sniffImageType(wave)).toBeNull()
  })
})

describe('createSharpTranscoder', () => {
  const transcoder = createSharpTranscoder()

  it('resizes to fit inside the spec, keeping the aspect ratio, as WebP', async () => {
    const result = await transcoder.transcode(await picture(1200, 630, 'jpeg'), THUMBNAIL_SPEC)
    expect(result).toMatchObject({ mediaType: 'image/webp', width: 640, height: 336 })
    expect(await describeImage(result.bytes)).toMatchObject({
      format: 'webp',
      width: 640,
      height: 336,
    })
  })

  it('never enlarges a small image', async () => {
    const result = await transcoder.transcode(await picture(32, 32, 'png'), FAVICON_SPEC)
    expect(result).toMatchObject({ width: 32, height: 32 })
  })

  it('fits a tall image by its height', async () => {
    const result = await transcoder.transcode(await picture(100, 1000, 'png'), THUMBNAIL_SPEC)
    expect(result).toMatchObject({ width: 64, height: 640 })
  })

  it('drops metadata from the output', async () => {
    const source = await picture(100, 100, 'jpeg', { exif: true })
    expect((await describeImage(source)).hasExif).toBe(true)
    const result = await transcoder.transcode(source, THUMBNAIL_SPEC)
    expect((await describeImage(result.bytes)).hasExif).toBe(false)
  })

  it('applies the EXIF orientation to the pixels before dropping it', async () => {
    const source = new Uint8Array(
      await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    )
    expect(await transcoder.transcode(source, THUMBNAIL_SPEC)).toMatchObject({
      width: 100,
      height: 200,
    })
  })

  it('turns an animated GIF into a still of its first frame', async () => {
    const frames = await sharp({
      create: { width: 20, height: 40, channels: 3, background: '#f00' },
    })
      .gif()
      .toBuffer()
    const result = await transcoder.transcode(new Uint8Array(frames), THUMBNAIL_SPEC)
    expect(await describeImage(result.bytes)).toMatchObject({
      format: 'webp',
      width: 20,
      height: 40,
    })
  })

  it('refuses bytes that are not an image', async () => {
    await expect(
      transcoder.transcode(new TextEncoder().encode('not an image'), THUMBNAIL_SPEC),
    ).rejects.toMatchObject({
      name: 'ImageTranscodeError',
      reason: 'invalid_image',
    })
  })

  it('refuses a truncated image', async () => {
    const whole = await picture(300, 300, 'png')
    await expect(transcoder.transcode(whole.subarray(0, 60), THUMBNAIL_SPEC)).rejects.toMatchObject(
      { reason: 'invalid_image' },
    )
  })

  it('refuses an image with more pixels than the limit, before decoding it', async () => {
    const strict = createSharpTranscoder({ maxInputPixels: 10_000 })
    await expect(
      strict.transcode(await picture(200, 200, 'png'), THUMBNAIL_SPEC),
    ).rejects.toMatchObject({
      reason: 'invalid_image',
    })
    expect(await strict.transcode(await picture(100, 100, 'png'), THUMBNAIL_SPEC)).toMatchObject({
      width: 100,
    })
  })
})

describe('createIsolatedTranscoder', () => {
  it('does the same work in a child process', async () => {
    const transcoder = createIsolatedTranscoder()
    const result = await transcoder.transcode(await picture(1200, 630, 'png'), THUMBNAIL_SPEC)
    expect(result).toMatchObject({ mediaType: 'image/webp', width: 640, height: 336 })
    await expect(sharp(result.bytes).metadata()).resolves.toMatchObject({ format: 'webp' })
  })

  it('reports an undecodable image as invalid, not as a crash', async () => {
    const transcoder = createIsolatedTranscoder()
    await expect(
      transcoder.transcode(new TextEncoder().encode('nope'), THUMBNAIL_SPEC),
    ).rejects.toMatchObject({
      reason: 'invalid_image',
    })
  })

  it('kills a worker that takes too long', async () => {
    const transcoder = createIsolatedTranscoder({ timeoutMs: 1 })
    await expect(
      transcoder.transcode(await picture(64, 64, 'png'), THUMBNAIL_SPEC),
    ).rejects.toMatchObject({
      reason: 'timeout',
    })
  })

  it('handles several images at once, each in its own process', async () => {
    const transcoder = createIsolatedTranscoder()
    const source = await picture(400, 400, 'jpeg')
    const results = await Promise.all(
      Array.from({ length: 4 }, () => transcoder.transcode(source, FAVICON_SPEC)),
    )
    expect(results.every((result) => result.width === 64)).toBe(true)
  })
})

const imageResponse = (body: Uint8Array, status = 200): OpenWebResponse => ({
  status,
  url: 'https://cdn.example/i.png',
  mediaType: 'image/png',
  charset: null,
  body,
  truncated: false,
})

function setUp(
  response: OpenWebResponse | Error,
  transcoder: ImageTranscoder = createSharpTranscoder(),
) {
  const get = vi.fn<OpenWebReader['get']>(async () => {
    if (response instanceof Error) throw response
    return response
  })
  const blobs = createInMemoryBlobStore()
  return { ingestor: createImageIngestor({ reader: { get }, transcoder, blobs }), get, blobs }
}

/** A worker the test drives by hand, to reach what a real one rarely does. */
function scriptedWorker(script: (worker: EventEmitter) => void) {
  const emitter = new EventEmitter()
  const kill = vi.fn<WorkerProcess['kill']>()
  const worker: WorkerProcess = {
    once: (event: string, listener: Parameters<EventEmitter['once']>[1]) =>
      emitter.once(event, listener),
    off: (event: string, listener: Parameters<EventEmitter['off']>[1]) =>
      emitter.off(event, listener),
    send: () => {
      queueMicrotask(() => script(emitter))
    },
    kill,
  }
  return { worker, kill, emitter }
}

describe('workerSpawnOptions', () => {
  it('gives the worker no environment, no output and a heap cap', () => {
    expect(workerSpawnOptions(128)).toMatchObject({
      env: {},
      execArgv: ['--max-old-space-size=128'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
  })
})

describe('createIsolatedTranscoder: a worker that misbehaves', () => {
  const bytes = new Uint8Array([1, 2, 3])

  it('treats a reply it cannot read as a crash', async () => {
    const { worker, kill } = scriptedWorker((emitter) => emitter.emit('message', 'nonsense'))
    const transcoder = createIsolatedTranscoder({ startWorker: () => worker })
    await expect(transcoder.transcode(bytes, THUMBNAIL_SPEC)).rejects.toMatchObject({
      reason: 'crashed',
    })
    expect(kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('treats a process that could not start as a crash', async () => {
    const { worker } = scriptedWorker((emitter) => emitter.emit('error', new Error('spawn EAGAIN')))
    const transcoder = createIsolatedTranscoder({ startWorker: () => worker })
    await expect(transcoder.transcode(bytes, THUMBNAIL_SPEC)).rejects.toMatchObject({
      reason: 'crashed',
    })
  })

  it('treats a process that dies without answering as a crash', async () => {
    const { worker } = scriptedWorker((emitter) => emitter.emit('exit', null, 'SIGSEGV'))
    const transcoder = createIsolatedTranscoder({ startWorker: () => worker })
    await expect(transcoder.transcode(bytes, THUMBNAIL_SPEC)).rejects.toMatchObject({
      reason: 'crashed',
    })
  })

  it.each([
    ['bytes that are not a WebP', { bytes: new Uint8Array([1, 2, 3]), width: 10, height: 10 }],
    ['a size larger than the job allowed', { width: 10_000, height: 10 }],
    ['a size that is not a whole number', { width: 10.5, height: 10 }],
    ['a size of zero', { width: 0, height: 10 }],
    ['bytes of the wrong kind', { bytes: 'RIFFxxxxWEBP', width: 10, height: 10 }],
    ['a media type it was not asked for', { mediaType: 'text/html', width: 10, height: 10 }],
  ])('refuses a worker reply with %s', async (_name, lie) => {
    const webp = new Uint8Array(
      await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
        .webp()
        .toBuffer(),
    )
    const honest = { bytes: webp, mediaType: 'image/webp', width: 10, height: 10 }
    const { worker } = scriptedWorker((emitter) =>
      emitter.emit('message', { ok: true, ...honest, ...lie }),
    )
    const transcoder = createIsolatedTranscoder({ startWorker: () => worker })
    await expect(transcoder.transcode(new Uint8Array([1]), THUMBNAIL_SPEC)).rejects.toMatchObject({
      reason: 'crashed',
    })
  })

  it('refuses a reply that is far larger than any thumbnail', async () => {
    const huge = new Uint8Array(3 * 1024 * 1024)
    huge.set(new TextEncoder().encode('RIFF'), 0)
    huge.set(new TextEncoder().encode('WEBP'), 8)
    const { worker } = scriptedWorker((emitter) =>
      emitter.emit('message', {
        ok: true,
        bytes: huge,
        mediaType: 'image/webp',
        width: 10,
        height: 10,
      }),
    )
    const transcoder = createIsolatedTranscoder({ startWorker: () => worker })
    await expect(transcoder.transcode(new Uint8Array([1]), THUMBNAIL_SPEC)).rejects.toMatchObject({
      reason: 'crashed',
    })
  })

  it('settles once, whatever else the worker does afterwards', async () => {
    const { worker } = scriptedWorker((emitter) => {
      emitter.emit('message', { ok: false, message: 'bad' })
      emitter.emit('exit', 1, null)
    })
    const transcoder = createIsolatedTranscoder({ startWorker: () => worker })
    await expect(transcoder.transcode(bytes, THUMBNAIL_SPEC)).rejects.toMatchObject({
      reason: 'invalid_image',
    })
  })
})

describe('createImageIngestor', () => {
  it('fetches, re-encodes and stores an image, answering its hash and size', async () => {
    const { ingestor, blobs } = setUp(imageResponse(await picture(1200, 630, 'png')))
    const stored = await ingestor.ingest('https://cdn.example/i.png', THUMBNAIL_SPEC)
    expect(stored).toMatchObject({ width: 640, height: 336, mediaType: 'image/webp' })
    expect(await blobs.has(stored?.hash ?? '')).toBe(true)
  })

  it('asks only for an image, within the image limits', async () => {
    const { ingestor, get } = setUp(imageResponse(await picture(10, 10, 'png')))
    await ingestor.ingest('https://cdn.example/i.png', THUMBNAIL_SPEC)
    expect(get.mock.calls[0]?.[0]).toMatchObject({ accept: ['image/*'], overflow: 'reject' })
  })

  it('stores identical pictures once', async () => {
    const source = await picture(300, 300, 'png')
    const first = setUp(imageResponse(source))
    const a = await first.ingestor.ingest('https://a.example/1.png', FAVICON_SPEC)
    const b = await first.ingestor.ingest('https://b.example/2.png', FAVICON_SPEC)
    expect(a?.hash).toBe(b?.hash)
  })

  it('answers null for SVG served as an image, without decoding it', async () => {
    const transcode = vi.fn<ImageTranscoder['transcode']>()
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    )
    const { ingestor } = setUp(imageResponse(svg), { transcode })
    expect(await ingestor.ingest('https://cdn.example/i.svg', THUMBNAIL_SPEC)).toBeNull()
    expect(transcode).not.toHaveBeenCalled()
  })

  it('answers null for a failing status, an empty body, a refused fetch and an undecodable image', async () => {
    expect(
      await setUp(imageResponse(new Uint8Array(0), 404)).ingestor.ingest(
        'https://x.example/i',
        THUMBNAIL_SPEC,
      ),
    ).toBeNull()
    expect(
      await setUp(imageResponse(new Uint8Array(0))).ingestor.ingest(
        'https://x.example/i',
        THUMBNAIL_SPEC,
      ),
    ).toBeNull()
    expect(
      await setUp(new OutboundRequestError('private_address', 'no')).ingestor.ingest(
        'https://x.example/i',
        THUMBNAIL_SPEC,
      ),
    ).toBeNull()
    const failing: ImageTranscoder = {
      transcode: async () => {
        throw new ImageTranscodeError('invalid_image', 'corrupt')
      },
    }
    expect(
      await setUp(imageResponse(await picture(10, 10, 'png')), failing).ingestor.ingest(
        'https://x.example/i',
        THUMBNAIL_SPEC,
      ),
    ).toBeNull()
  })
})

async function tinyWebp() {
  return new Uint8Array(
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
      .webp()
      .toBuffer(),
  )
}

const oneJob = (transcoder: ReturnType<typeof createIsolatedTranscoder>) =>
  transcoder.transcode(new Uint8Array([1]), THUMBNAIL_SPEC)

describe('createIsolatedTranscoder: the pool', () => {
  /** Workers that answer every job with a valid reply, after `delayMs`. */
  async function pool(options: Parameters<typeof createIsolatedTranscoder>[0] = {}, delayMs = 0) {
    const reply = await tinyWebp()
    const started: ReturnType<typeof scriptedWorker>[] = []
    let running = 0
    let peak = 0
    const transcoder = createIsolatedTranscoder({
      ...options,
      startWorker: () => {
        const made = scriptedWorker((emitter) => {
          running += 1
          peak = Math.max(peak, running)
          setTimeout(() => {
            running -= 1
            emitter.emit('message', {
              ok: true,
              bytes: reply,
              mediaType: 'image/webp',
              width: 10,
              height: 10,
            })
          }, delayMs)
        })
        started.push(made)
        return made.worker
      },
    })
    return { transcoder, started, peak: () => peak }
  }

  it('reuses a worker for the next image instead of starting another', async () => {
    const { transcoder, started } = await pool()
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- one after another is the point.
      await oneJob(transcoder)
    }
    expect(started).toHaveLength(1)
    expect(started[0]?.kill).not.toHaveBeenCalled()
    transcoder.close()
  })

  it('leaves no listener behind on a worker after each image', async () => {
    const { transcoder, started } = await pool()
    await oneJob(transcoder)
    await oneJob(transcoder)
    const emitter = started[0]?.emitter
    expect(emitter?.listenerCount('message')).toBe(0)
    expect(emitter?.listenerCount('error')).toBe(0)
    // The one that notices a worker dying while it waits.
    expect(emitter?.listenerCount('exit')).toBe(1)
    transcoder.close()
  })

  it('replaces a worker after the number of images it is allowed', async () => {
    const { transcoder, started } = await pool({ recycleAfter: 2 })
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- one after another is the point.
      await oneJob(transcoder)
    }
    expect(started).toHaveLength(3)
    expect(started[0]?.kill).toHaveBeenCalledWith('SIGKILL')
    expect(started[1]?.kill).toHaveBeenCalledWith('SIGKILL')
    expect(started[2]?.kill).not.toHaveBeenCalled()
    transcoder.close()
  })

  it('never decodes more images at once than the pool allows, and queues the rest', async () => {
    const { transcoder, started, peak } = await pool({ poolSize: 2 }, 30)
    await Promise.all(Array.from({ length: 6 }, () => oneJob(transcoder)))
    expect(peak()).toBe(2)
    expect(started).toHaveLength(2)
    transcoder.close()
  })

  it('kills a worker that failed and gives the next image a fresh one', async () => {
    const reply = await tinyWebp()
    let first = true
    const started: ReturnType<typeof scriptedWorker>[] = []
    const transcoder = createIsolatedTranscoder({
      startWorker: () => {
        const made = scriptedWorker((emitter) => {
          if (first) {
            first = false
            emitter.emit('exit', 139, null)
          } else {
            emitter.emit('message', {
              ok: true,
              bytes: reply,
              mediaType: 'image/webp',
              width: 10,
              height: 10,
            })
          }
        })
        started.push(made)
        return made.worker
      },
    })
    await expect(oneJob(transcoder)).rejects.toMatchObject({ reason: 'crashed' })
    expect(started[0]?.kill).toHaveBeenCalledWith('SIGKILL')
    await expect(oneJob(transcoder)).resolves.toMatchObject({ width: 10 })
    expect(started).toHaveLength(2)
    transcoder.close()
  })

  it('does not trust a worker with the next image after it refused one', async () => {
    const started: ReturnType<typeof scriptedWorker>[] = []
    const transcoder = createIsolatedTranscoder({
      startWorker: () => {
        const made = scriptedWorker((emitter) =>
          emitter.emit('message', { ok: false, message: 'corrupt' }),
        )
        started.push(made)
        return made.worker
      },
    })
    await expect(oneJob(transcoder)).rejects.toMatchObject({ reason: 'invalid_image' })
    await expect(oneJob(transcoder)).rejects.toMatchObject({ reason: 'invalid_image' })
    expect(started).toHaveLength(2)
    transcoder.close()
  })

  it('does not hand out a worker that died while it was waiting', async () => {
    const { transcoder, started } = await pool()
    await oneJob(transcoder)
    started[0]?.emitter.emit('exit', 1, null)
    await oneJob(transcoder)
    expect(started).toHaveLength(2)
    transcoder.close()
  })

  it('stops a worker that has been idle too long, and starts one when it is next needed', async () => {
    const { transcoder, started } = await pool({ idleMs: 20 })
    await oneJob(transcoder)
    await new Promise((done) => setTimeout(done, 80))
    expect(started[0]?.kill).toHaveBeenCalledWith('SIGKILL')
    await oneJob(transcoder)
    expect(started).toHaveLength(2)
    transcoder.close()
  })

  it('stops its idle workers when closed, and any worker that finishes afterwards', async () => {
    const { transcoder, started } = await pool({ poolSize: 2 }, 30)
    await Promise.all([oneJob(transcoder), oneJob(transcoder)])
    transcoder.close()
    expect(started.every((made) => made.kill.mock.calls.length > 0)).toBe(true)

    const later = await pool({}, 20)
    const running = oneJob(later.transcoder)
    later.transcoder.close()
    await running
    expect(later.started[0]?.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('does the real work in real workers, reused, and recycled when it should be', async () => {
    const transcoder = createIsolatedTranscoder({ poolSize: 2, recycleAfter: 3 })
    const source = new Uint8Array(
      await sharp({ create: { width: 300, height: 200, channels: 3, background: '#36c' } })
        .png()
        .toBuffer(),
    )
    const results = []
    for (let i = 0; i < 7; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- one after another exercises reuse and recycling.
      results.push(await transcoder.transcode(source, THUMBNAIL_SPEC))
    }
    expect(results.every((result) => result.width === 300 && result.height === 200)).toBe(true)
    transcoder.close()
  })
})
