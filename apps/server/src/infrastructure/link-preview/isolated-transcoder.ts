import { fork } from 'node:child_process'
import type { ForkOptions } from 'node:child_process'

import { createLimiter } from '../http/limiter.ts'
import { sniffImageType } from './image-sniff.ts'
import { ImageTranscodeError } from './image-transcoder.ts'
import type { ImageSpec, ImageTranscoder, TranscodedImage } from './image-transcoder.ts'
import type { TranscodeReply } from './transcode-worker.ts'

/**
 * Runs images through `transcode-worker.ts` in child processes (ADR-047,
 * "Isolated decoding").
 *
 * Image codecs are native code reading attacker-controlled bytes. A bug in one
 * is a crash or a hang at best, so the decode happens where a crash costs a job
 * and a hang can be killed.
 *
 * **A small pool, not a process per image.** Starting a process that loads the
 * codec costs about half a second and 70 MiB, and measured on a 1200x630 image
 * the decode itself is a small fraction of that. So workers are kept and reused:
 *
 * - at most `poolSize` run at once, which is also the most memory the codec can
 *   take (the rest of the images wait their turn);
 * - an idle worker is stopped after `idleMs`, so a quiet server holds none;
 * - a worker is replaced after `recycleAfter` images, so a slow leak in the
 *   native library cannot accumulate;
 * - **a worker that fails in any way is killed, never reused.** A timeout, a crash,
 *   an unreadable or implausible reply: whatever state it was in is gone with it,
 *   and the next image gets a fresh one.
 *
 * Reusing a worker means one image's bytes can be in the memory of the process
 * that decodes the next. All of it is public web content, and the worker holds
 * no credentials (below), so this widens nothing that matters; it is the price
 * of not paying for a process each time, and it is why failures kill.
 *
 * The child gets a heap cap, no environment and a wall-clock limit per image.
 * The cap bounds the JavaScript side; libvips' own memory is bounded by the
 * input pixel limit (`sharp-transcoder.ts`).
 */

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_HEAP_MB = 256
const DEFAULT_POOL_SIZE = 2
const DEFAULT_RECYCLE_AFTER = 100
const DEFAULT_IDLE_MS = 30_000
/** A 640-pixel WebP is tens of kilobytes; this is the ceiling, not the expectation. */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const WORKER = new URL('./transcode-worker.ts', import.meta.url)

/** The part of a child process this module uses; a test supplies its own. */
export interface WorkerProcess {
  once(event: 'message', listener: (message: unknown) => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown
  off(event: 'message', listener: (message: unknown) => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown
  send(message: unknown): unknown
  kill(signal: 'SIGKILL'): unknown
}

export interface IsolatedTranscoderOptions {
  readonly timeoutMs?: number
  readonly maxHeapMb?: number
  /** Workers, and so images decoded at once. */
  readonly poolSize?: number
  /** A worker is replaced after this many images. */
  readonly recycleAfter?: number
  /** An idle worker is stopped after this long. */
  readonly idleMs?: number
  /** Starts a worker. The default forks `transcode-worker.ts`. */
  readonly startWorker?: (maxHeapMb: number) => WorkerProcess
}

export interface IsolatedTranscoder extends ImageTranscoder {
  /** Stops every idle worker and every one that finishes from now on. */
  close(): void
}

/** How the worker is started. Exported so a test can pin what matters: it gets no environment. */
export function workerSpawnOptions(maxHeapMb: number): ForkOptions {
  return {
    // `advanced` serialisation moves the bytes as a typed array, not as JSON.
    serialization: 'advanced',
    execArgv: [`--max-old-space-size=${maxHeapMb}`],
    // Nothing from the server's environment: it holds the database URL, the
    // session and encryption keys, and every integration credential, and a
    // codec exploit that runs code in this process must find none of them.
    env: {},
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  }
}

function forkWorker(maxHeapMb: number): WorkerProcess {
  const child = fork(WORKER, [], workerSpawnOptions(maxHeapMb))
  // A worker must never be the reason the server cannot exit.
  child.unref()
  child.channel?.unref()
  return child
}

function isReply(message: unknown): message is TranscodeReply {
  return typeof message === 'object' && message !== null && 'ok' in message
}

/**
 * Whether a successful reply is what a healthy worker would send for this job.
 *
 * The worker is the process most likely to be compromised, since it is the one
 * that parses attacker-controlled bytes, so its reply is untrusted too: what
 * it returns is stored and later served from our own origin. The bytes must
 * still be a WebP, no larger than the job allowed, and the sizes it reports
 * must be the size it was asked for or less.
 */
function isHonestResult(reply: TranscodedImage, spec: ImageSpec): boolean {
  return (
    reply.bytes instanceof Uint8Array &&
    reply.bytes.byteLength <= MAX_OUTPUT_BYTES &&
    sniffImageType(reply.bytes) === 'image/webp' &&
    reply.mediaType === 'image/webp' &&
    Number.isInteger(reply.width) &&
    Number.isInteger(reply.height) &&
    reply.width > 0 &&
    reply.height > 0 &&
    reply.width <= spec.maxWidth &&
    reply.height <= spec.maxHeight
  )
}

interface Worker {
  readonly process: WorkerProcess
  images: number
  idleTimer: ReturnType<typeof setTimeout> | undefined
}

export function createIsolatedTranscoder(
  options: IsolatedTranscoderOptions = {},
): IsolatedTranscoder {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxHeapMb = options.maxHeapMb ?? DEFAULT_MAX_HEAP_MB
  const recycleAfter = options.recycleAfter ?? DEFAULT_RECYCLE_AFTER
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const startWorker = options.startWorker ?? forkWorker
  // Never refuses: the callers upstream already bound how much can be waiting.
  const turns = createLimiter({
    maxConcurrent: options.poolSize ?? DEFAULT_POOL_SIZE,
    maxQueued: Number.MAX_SAFE_INTEGER,
  })
  const idle: Worker[] = []
  let closed = false

  function retire(worker: Worker): void {
    clearTimeout(worker.idleTimer)
    const at = idle.indexOf(worker)
    if (at !== -1) idle.splice(at, 1)
    worker.process.kill('SIGKILL')
  }

  function take(): Worker {
    const reusable = idle.pop()
    if (reusable !== undefined) {
      clearTimeout(reusable.idleTimer)
      return reusable
    }
    const worker: Worker = { process: startWorker(maxHeapMb), images: 0, idleTimer: undefined }
    // A worker that dies while it waits for work is simply not there next time.
    worker.process.once('exit', () => retire(worker))
    return worker
  }

  function giveBack(worker: Worker): void {
    worker.images += 1
    if (closed || worker.images >= recycleAfter) {
      retire(worker)
      return
    }
    worker.idleTimer = setTimeout(() => retire(worker), idleMs)
    worker.idleTimer.unref()
    idle.push(worker)
  }

  /** One image, on one worker. Resolves or rejects exactly once, and leaves no listener behind. */
  function run(worker: Worker, bytes: Uint8Array, spec: ImageSpec): Promise<TranscodedImage> {
    return new Promise((resolve, reject) => {
      const { process: child } = worker
      const finish = () => {
        clearTimeout(timer)
        child.off('message', onMessage)
        child.off('error', onError)
        child.off('exit', onExit)
      }
      const fail = (error: ImageTranscodeError) => {
        finish()
        reject(error)
      }
      const onMessage = (message: unknown) => {
        if (!isReply(message)) {
          fail(new ImageTranscodeError('crashed', 'The image worker sent an unreadable reply'))
        } else if (message.ok && !isHonestResult(message, spec)) {
          fail(new ImageTranscodeError('crashed', 'The image worker sent an implausible result'))
        } else if (message.ok) {
          finish()
          resolve({
            bytes: message.bytes,
            mediaType: message.mediaType,
            width: message.width,
            height: message.height,
          })
        } else {
          // A refusal of this image, from a worker that is otherwise fine.
          finish()
          reject(new ImageTranscodeError('invalid_image', message.message))
        }
      }
      const onError = (error: Error) =>
        fail(new ImageTranscodeError('crashed', `The image worker failed: ${String(error)}`))
      const onExit = (code: number | null, signal: string | null) =>
        fail(
          new ImageTranscodeError(
            'crashed',
            `The image worker exited (${String(code ?? signal)}) without a result`,
          ),
        )
      const timer = setTimeout(
        () => fail(new ImageTranscodeError('timeout', `No result within ${timeoutMs} ms`)),
        timeoutMs,
      )

      child.once('message', onMessage)
      child.once('error', onError)
      child.once('exit', onExit)
      child.send({ bytes, spec })
    })
  }

  return {
    transcode(bytes, spec) {
      return turns.run(async () => {
        const worker = take()
        try {
          const image = await run(worker, bytes, spec)
          giveBack(worker)
          return image
        } catch (error) {
          // Any failure, a refusal of the image included: an image that could not be decoded is
          // the likeliest one to have been built to attack the decoder, so its worker is not reused.
          retire(worker)
          throw error
        }
      })
    },
    close() {
      closed = true
      // `retire` takes a worker out of the list as it goes, so take them from the end.
      for (let worker = idle.at(-1); worker !== undefined; worker = idle.at(-1)) retire(worker)
    },
  }
}
