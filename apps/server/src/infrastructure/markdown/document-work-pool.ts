import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'

import type { DocumentInspection, DocumentWork, RenderedContent } from '@quill/application'

import type { DocumentTask } from './document-work-worker.ts'
import { createKeptByText, KEPT_TEXT_MAX_CHARS } from './parsed-trees.ts'

/**
 * The document work of ADR-062, step 3, on a pool of worker threads: a
 * sync's inspections and renders, many at once, so its wall time is not one
 * thread's CPU time.
 *
 * - **Bounded.** At most `size` threads (by default half the machine's
 *   logical cores, between one and four), each with a hard heap cap.
 *   Threads start when there is work and stop after `idleMs` without any.
 * - **Deterministic.** Each batch's answers are in the order of its inputs,
 *   whichever thread answered and whenever. The largest items are handed out
 *   first, so one long document does not start last.
 * - **Parsed once.** A render goes to the thread that inspected its text,
 *   which kept the tree (`parsed-trees.ts`), unless another thread has
 *   nothing of its own left to do. Where it goes never changes the answer.
 * - **One renderer.** Each thread builds the format as the server does, and
 *   its extension signature must equal the server's, or the pool refuses it:
 *   a body rendered by another renderer would be cached under the wrong key.
 * - **A crash is retried once.** A thread that dies (out of memory, say)
 *   is replaced, and the item it held is tried once more on a fresh thread.
 *   An item that kills a second thread fails its batch; an item whose render
 *   throws fails its batch at once, as it would on the calling thread.
 */

export interface DocumentWorkPoolOptions {
  /** The extension signature of the format the server renders with (`DocumentFormat.extensions`). */
  readonly extensions: string
  readonly size?: number
  /** A thread's old-generation heap cap, in megabytes. */
  readonly maxHeapMb?: number
  readonly idleMs?: number
  /** Another thread's module, and what it is started with. Tests only. */
  readonly worker?: { readonly url: URL; readonly data?: unknown }
}

export interface DocumentWorkPool extends DocumentWork {
  /** The most threads it runs at once. */
  readonly size: number
  /** Stops every thread; work asked for afterwards starts them again. */
  close(): Promise<void>
  /** How long each thread started so far took to be ready, in milliseconds, oldest first. */
  startups(): readonly number[]
}

/** Where the build writes the module, and where the pool looks for it. */
export const BUILT_DOCUMENT_WORKER = new URL(
  '../../../dist/document-work-worker.mjs',
  import.meta.url,
)

/** The thread's TypeScript source. */
export const DOCUMENT_WORKER_SOURCE = new URL('./document-work-worker.ts', import.meta.url)

/** Where the build lists what the built module was built from. */
export function workerManifest(module: URL): URL {
  return new URL(module.href.replace(/\.mjs$/u, '.json'))
}

/** A digest of these files' contents, in this order: what a build was made from. */
export function sourcesDigest(files: readonly string[]): string {
  const hash = createHash('sha256')
  for (const file of files) hash.update(file).update('\0').update(readFileSync(file)).update('\0')
  return hash.digest('hex')
}

/**
 * The built module when the build has written one from the sources as they
 * are now, else the source itself. A module built from older sources would
 * render as the code once did, and its bodies would be cached under keys the
 * current renderer computes, so a built module whose sources have changed
 * since, or gone, is never used.
 */
export function documentWorkerModule(built: URL = BUILT_DOCUMENT_WORKER): URL {
  try {
    const manifest: { readonly sources?: unknown; readonly digest?: unknown } = JSON.parse(
      readFileSync(workerManifest(built), 'utf8'),
    )
    const { sources, digest } = manifest
    const listed = Array.isArray(sources) && sources.every((file) => typeof file === 'string')
    if (listed && existsSync(built) && sourcesDigest(sources) === digest) return built
  } catch {
    // No manifest, or a source it lists is gone: the source it is.
  }
  return DOCUMENT_WORKER_SOURCE
}

/**
 * Half the logical cores, between one and four (ADR-062, "Amendment: the
 * pool and the parser's rate"). A hosted runner's four vCPUs are two cores
 * with two hardware threads each: there, two threads synced L faster than
 * three or four, with 40% less CPU time, because the parse is bound by the
 * core, not the thread. Four was as fast as eight, with half the memory.
 */
export function defaultPoolSize(cores = availableParallelism()): number {
  return Math.min(4, Math.max(1, Math.floor(cores / 2)))
}

type Answer = { readonly value: unknown } | { readonly error: string }

interface Job {
  readonly task: DocumentTask
  readonly weight: number
  /** The thread that inspected a render's text, and so holds its tree. */
  readonly home: Thread | undefined
  readonly settle: (answer: Answer | 'crashed') => void
  attempts: number
}

interface Thread {
  readonly worker: Worker
  readonly ready: Promise<void>
  job: Job | null
}

export function createDocumentWorkPool(options: DocumentWorkPoolOptions): DocumentWorkPool {
  const size = options.size ?? defaultPoolSize()
  const maxHeapMb = options.maxHeapMb ?? 512
  const idleMs = options.idleMs ?? 30_000
  const threads = new Set<Thread>()
  const queue: Job[] = []
  let nextId = 0
  let idle: ReturnType<typeof setTimeout> | undefined
  const startups: number[] = []
  // Which thread inspected a text: as many texts as the threads keep trees for.
  const homes = createKeptByText<Thread>(size * KEPT_TEXT_MAX_CHARS)

  const start = (): Thread => {
    const started = performance.now()
    const worker = new Worker(options.worker?.url ?? documentWorkerModule(), {
      resourceLimits: { maxOldGenerationSizeMb: maxHeapMb },
      workerData: options.worker?.data,
    })
    let thread: Thread
    // A thread's first message names the extensions its renderer has.
    const ready = new Promise<void>((resolve, reject) => {
      worker.once('message', (message: { readonly ready?: string }) => {
        startups.push(performance.now() - started)
        if (message.ready === options.extensions) resolve()
        else reject(new Error('A document worker renders with other extensions than the server.'))
      })
    })
    thread = { worker, ready, job: null }
    worker.on(
      'message',
      (message: { readonly id?: number; readonly value?: unknown; readonly error?: string }) => {
        const { job } = thread
        if (job === null || message.id !== job.task.id) return
        thread.job = null
        // The thread keeps the tree of a text it inspected, for the text's render.
        if (job.task.kind === 'inspect' && message.error === undefined) {
          homes.keep(job.task.item, thread)
        }
        job.settle(
          message.error === undefined ? { value: message.value } : { error: message.error },
        )
        dispatch()
      },
    )
    const lost = () => {
      threads.delete(thread)
      const { job } = thread
      thread.job = null
      if (job !== null) job.settle('crashed')
      dispatch()
    }
    worker.on('error', lost)
    worker.on('exit', lost)
    threads.add(thread)
    return thread
  }

  const dispatch = (): void => {
    if (idle !== undefined) clearTimeout(idle)
    while (queue.length > 0) {
      let free = [...threads].find((thread) => thread.job === null)
      if (free === undefined && threads.size < size) free = start()
      if (free === undefined) return
      const thread = free
      // Its own work first: the renders of the texts it inspected.
      const own = queue.findIndex((queued) => queued.home === thread)
      const [job] = queue.splice(own === -1 ? 0 : own, 1)
      /* v8 ignore next -- the loop runs only while the queue holds a job. */
      if (job === undefined) return
      thread.job = job
      thread.ready.then(
        // A worker thread's port, not a window: there is no origin to name.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        () => thread.worker.postMessage(job.task),
        () => {
          thread.job = null
          job.settle({ error: 'A document worker renders with other extensions than the server.' })
          void thread.worker.terminate()
        },
      )
    }
    if ([...threads].every((thread) => thread.job === null)) {
      idle = setTimeout(() => void close(), idleMs)
      idle.unref()
    }
  }

  /** Runs tasks across the threads; answers in the tasks' order, each checked to be what it claims. */
  const run = <T>(
    tasks: readonly DocumentTask[],
    accept: (value: unknown) => value is T,
  ): Promise<readonly T[]> =>
    new Promise((resolve, reject) => {
      const answers: T[] = []
      let remaining = tasks.length
      let failed = false
      // Called once at most: every answer after a failure is ignored first.
      const fail = (error: Error): void => {
        failed = true
        reject(error)
      }
      if (remaining === 0) {
        resolve([])
        return
      }
      const jobs = tasks.map((task, index): Job => {
        const job: Job = {
          task,
          weight: task.kind === 'inspect' ? task.item.length : task.item.markdown.length,
          home: task.kind === 'render' ? homes.take(task.item.markdown) : undefined,
          attempts: 0,
          settle: (answer) => {
            if (failed) return
            if (answer === 'crashed') {
              job.attempts += 1
              if (job.attempts < 2) queue.unshift(job)
              else fail(new Error(`A document worker stopped twice on item ${index} of a batch.`))
              return
            }
            if ('error' in answer) {
              fail(new Error(answer.error))
              return
            }
            if (!accept(answer.value)) {
              fail(new Error(`A document worker answered item ${index} with something else.`))
              return
            }
            answers[index] = answer.value
            remaining -= 1
            if (remaining === 0) resolve(answers)
          },
        }
        return job
      })
      // The largest first, so the batch is not left waiting on one long item at the end.
      queue.push(...jobs.toSorted((left, right) => right.weight - left.weight))
      dispatch()
    })

  const close = async (): Promise<void> => {
    if (idle !== undefined) clearTimeout(idle)
    homes.clear()
    const stopping = [...threads].map((thread) => thread.worker.terminate())
    threads.clear()
    await Promise.all(stopping)
  }

  return {
    size,
    inspect: (markdowns) =>
      run(
        markdowns.map((item): DocumentTask => ({ id: nextId++, kind: 'inspect', item })),
        isInspection,
      ),
    render: (inputs) =>
      run(
        inputs.map((item): DocumentTask => ({ id: nextId++, kind: 'render', item })),
        isRendered,
      ),
    close,
    startups: () => [...startups],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** An inspection, as far as the pool relies on its shape. */
function isInspection(value: unknown): value is DocumentInspection {
  return isRecord(value) && isRecord(value['view']) && Array.isArray(value['links'])
}

/** A rendered body, as far as the pool relies on its shape. */
function isRendered(value: unknown): value is RenderedContent {
  return isRecord(value) && typeof value['html'] === 'string'
}
