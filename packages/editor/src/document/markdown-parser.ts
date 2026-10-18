import {
  CHUNK_SIZES,
  createChunkSchedule,
  normaliseMarkdown,
  planChunks,
} from '@quill/markdown/chunks'
import type { ChunkJob, ChunkResult, ChunkSizes } from '@quill/markdown/chunks'

import { answerChunk } from './paste-chunk.ts'
import type { ChunkResponse, PasteBlocks } from './paste-chunk.ts'

/**
 * Where a large paste's Markdown is parsed (quill-plan.md section 31: the
 * first screenful of a paste is on screen within 300 ms, and the main thread
 * is never blocked while the rest is parsed).
 *
 * Parsing is the part of a paste that grows with the clipboard: micromark
 * reads a 4,100-line runbook in about a third of a second, and four times that
 * on a slow phone. So the document is cut into pieces that each parse exactly
 * as they would in the whole (`@quill/markdown/chunks`), the pieces are parsed
 * and converted to editor blocks by a pool of module workers, and each piece's
 * blocks are handed over as soon as every piece before it has been: the page
 * sees the first screenful while the rest is still being read, and on a
 * machine with cores to spare the rest is read several pieces at a time.
 *
 * Ports and adapters (`docs/architecture/patterns.md`): a piece is parsed by
 * a `RunChunk`, which is a pool of workers where the browser has workers and
 * the page itself where it has none (jsdom) or where a worker fails — a worker
 * that cannot be built, cannot parse a piece, or dies hands its piece back to
 * the page rather than losing a paste.
 */

/** One piece's blocks, and how far through the paste they reach, from 0 to 1. */
export interface PasteBatch {
  readonly blocks: PasteBlocks
  readonly progress: number
}

/**
 * Parses a clipboard's Markdown, handing over its blocks a piece at a time,
 * in order. Resolves once the last piece is handed over; rejects if the
 * Markdown cannot be parsed, or when `signal` abandons the paste.
 */
export type ParseMarkdown = (
  markdown: string,
  onBatch: (batch: PasteBatch) => void,
  signal: AbortSignal,
) => Promise<void>

/** Parses and converts one piece; `signal` lets a piece not yet started be dropped. */
export type RunChunk = (job: ChunkJob, signal?: AbortSignal) => Promise<ChunkResult<PasteBlocks>>

/** Parses `markdown` piece by piece through `run`, keeping every piece it can in flight. */
export function streamMarkdown(run: RunChunk, sizes: ChunkSizes = CHUNK_SIZES): ParseMarkdown {
  return (markdown, onBatch, signal) =>
    new Promise((resolve, reject) => {
      const schedule = createChunkSchedule<PasteBlocks>(
        planChunks(normaliseMarkdown(markdown), sizes),
      )
      let running = 0
      let over = false
      const fail = (error: unknown): void => {
        over = true
        reject(error)
      }
      signal.addEventListener('abort', () => fail(signal.reason), { once: true })

      const take = (result: ChunkResult<PasteBlocks>): void => {
        running -= 1
        if (over) return
        try {
          for (const { payload, progress } of schedule.settle(result)) {
            onBatch({ blocks: payload, progress })
            if (over) return
          }
        } catch (error) {
          fail(error)
          return
        }
        if (schedule.finished) {
          over = true
          resolve()
          return
        }
        pump()
      }

      function pump(): void {
        for (let job = schedule.next(); job !== undefined; job = schedule.next()) {
          running += 1
          run(job, signal).then(take, fail)
        }
        /* v8 ignore next -- the schedule always has a parse to run until it finishes. */
        if (running === 0 && !schedule.finished) fail(new Error('The paste stopped short.'))
      }

      pump()
    })
}

/** After the current task, so a piece parsed in the page is a task of its own. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** Parses each piece in the page, one task each: the slow path, with nowhere better to go. */
export function inPageRunner(): RunChunk {
  return async (job) => {
    await nextTask()
    const response = answerChunk(job)
    if ('error' in response) throw new Error(response.error)
    return response.result
  }
}

/** The slice of a `Worker` the pool uses. */
export interface WorkerLike {
  postMessage(job: ChunkJob): void
  addEventListener(type: 'message', listener: (event: MessageEvent<ChunkResponse>) => void): void
  addEventListener(type: 'error', listener: () => void): void
  terminate(): void
}

export interface WorkerPool extends RunChunk {
  /** Starts one worker ahead of the first paste, so that paste does not wait for it to load. */
  warm(): void
}

interface Waiting {
  readonly job: ChunkJob
  readonly signal: AbortSignal | undefined
  resolve(result: ChunkResult<PasteBlocks>): void
  reject(error: unknown): void
}

interface Slot {
  readonly worker: WorkerLike
  busy: Waiting | undefined
}

/**
 * Up to `size` workers, built as pieces need them, each given one piece at a
 * time so that the next piece always goes to whichever is free first.
 */
export function workerPoolRunner(create: () => WorkerLike, size: number): WorkerPool {
  const inPage = inPageRunner()
  const slots: Slot[] = []
  const queue: Waiting[] = []
  let unbuildable = false

  const inPageFor = (waiting: Waiting): void => {
    inPage(waiting.job).then(waiting.resolve, waiting.reject)
  }

  const answer = (slot: Slot, response: ChunkResponse): void => {
    const waiting = slot.busy
    if (waiting?.job.id !== response.id) return
    slot.busy = undefined
    if ('result' in response) waiting.resolve(response.result)
    else inPageFor(waiting)
    dispatch()
  }

  const build = (): Slot | undefined => {
    if (unbuildable) return undefined
    let worker: WorkerLike
    try {
      worker = create()
    } catch {
      unbuildable = true
      return undefined
    }
    const slot: Slot = { worker, busy: undefined }
    worker.addEventListener('message', ({ data }) => {
      answer(slot, data)
    })
    worker.addEventListener('error', () => {
      worker.terminate()
      slots.splice(slots.indexOf(slot), 1)
      const waiting = slot.busy
      slot.busy = undefined
      if (waiting !== undefined) inPageFor(waiting)
      dispatch()
    })
    slots.push(slot)
    return slot
  }

  function dispatch(): void {
    for (let waiting = queue[0]; waiting !== undefined; waiting = queue[0]) {
      if (waiting.signal?.aborted === true) {
        queue.shift()
        waiting.reject(waiting.signal.reason)
        continue
      }
      const slot =
        slots.find((candidate) => candidate.busy === undefined) ??
        (slots.length < size ? build() : undefined)
      if (slot === undefined) {
        if (slots.length > 0) return
        // No worker to wait for, and none can be built.
        queue.shift()
        inPageFor(waiting)
        continue
      }
      queue.shift()
      slot.busy = waiting
      // A worker's postMessage has no target origin; the rule is about windows.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      slot.worker.postMessage(waiting.job)
    }
  }

  const run: RunChunk = (job, signal) =>
    new Promise((resolve, reject) => {
      queue.push({ job, signal, resolve, reject })
      dispatch()
    })
  return Object.assign(run, {
    warm: () => {
      if (slots.length === 0) build()
    },
  })
}

/**
 * How many workers a paste is parsed by: a core for each, leaving one for the
 * page, and no more than four, past which a paste is no faster.
 */
export function pasteWorkerCount(cores: number | undefined): number {
  return Math.min(4, Math.max(1, (cores ?? 2) - 1))
}

/** The module worker, written the way the bundler recognises and splits into its own chunk. */
function createParseWorker(): WorkerLike {
  return new Worker(new URL('./markdown-parse.worker.ts', import.meta.url), { type: 'module' })
}

let pool: WorkerPool | undefined

function pagePool(): WorkerPool {
  pool ??= workerPoolRunner(
    createParseWorker,
    pasteWorkerCount(globalThis.navigator.hardwareConcurrency),
  )
  return pool
}

let page: ParseMarkdown | undefined

/** The page's parser: one pool of workers for every editor on it, or the page where there are no workers. */
export function pageMarkdownParser(): ParseMarkdown {
  if (typeof Worker === 'undefined') return streamMarkdown(inPageRunner())
  page ??= streamMarkdown(pagePool())
  return page
}

/** Starts a parse worker ahead of the first large paste, where the browser has workers. */
export function warmMarkdownParser(): void {
  if (typeof Worker !== 'undefined') pagePool().warm()
}
