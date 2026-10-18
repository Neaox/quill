import { blocksFromMdast } from '@quill/markdown/blocks'
import type { ChunkJob } from '@quill/markdown/chunks'
import { parseMarkdown } from '@quill/markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { longDocumentMarkdown } from '../testing/long-document.ts'
import {
  inPageRunner,
  pageMarkdownParser,
  pasteWorkerCount,
  streamMarkdown,
  warmMarkdownParser,
  workerPoolRunner,
} from './markdown-parser.ts'
import type { PasteBatch, RunChunk, WorkerLike } from './markdown-parser.ts'
import { answerChunk } from './paste-chunk.ts'
import type { ChunkResponse } from './paste-chunk.ts'

/**
 * A large paste is parsed in pieces, off the main thread, and handed over a
 * piece at a time (quill-plan.md section 31). The workers are a port: a
 * browser runs a pool of module workers, jsdom has none and parses in the
 * page, and a test drives fakes that answer when told to.
 */

const SMALL = { first: 1, rest: 1 }

/** Collects a whole paste's batches. */
async function batchesOf(
  run: RunChunk,
  markdown: string,
  signal = new AbortController().signal,
): Promise<PasteBatch[]> {
  const batches: PasteBatch[] = []
  await streamMarkdown(run, SMALL)(markdown, (batch) => batches.push(batch), signal)
  return batches
}

/** A worker whose answers the test releases, or that fails when told. */
function fakeWorker() {
  const sent: ChunkJob[] = []
  const listeners = {
    message: new Set<(event: MessageEvent<ChunkResponse>) => void>(),
    error: new Set<() => void>(),
  }
  let terminated = false
  const worker: WorkerLike = {
    postMessage: (job) => {
      sent.push(job)
    },
    addEventListener: (type, listener) => {
      listeners[type].add(listener as never)
    },
    terminate: () => {
      terminated = true
    },
  }
  return {
    worker,
    sent,
    get terminated() {
      return terminated
    },
    /** Answers the oldest job not yet answered, as the real worker would, or with `response`. */
    answer(response?: ChunkResponse) {
      const job = sent.shift()
      if (job === undefined) throw new Error('Nothing to answer.')
      const data = response ?? answerChunk(job)
      for (const listener of listeners.message) listener(new MessageEvent('message', { data }))
    },
    fail() {
      for (const listener of listeners.error) listener()
    },
  }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A runner that can parse nothing. */
const unparseable: RunChunk = () => Promise.reject(new Error('out of memory'))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streaming a paste', () => {
  it('hands over every block of the document, in order, a piece at a time', async () => {
    const markdown = '# One\n\nText.\n\n## Two\n\nMore text.\n'
    const batches = await batchesOf(inPageRunner(), markdown)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.flatMap((batch) => batch.blocks)).toEqual(
      blocksFromMdast(parseMarkdown(markdown).children),
    )
    expect(batches.map((batch) => batch.progress)).toEqual(
      batches.map((batch) => batch.progress).toSorted((a, b) => a - b),
    )
    expect(batches.at(-1)?.progress).toBe(1)
  })

  it('hands over the long document exactly as a parse of the whole', async () => {
    const markdown = longDocumentMarkdown(20)
    const batches: PasteBatch[] = []
    await streamMarkdown(inPageRunner())(
      markdown,
      (batch) => batches.push(batch),
      new AbortController().signal,
    )
    expect(batches.flatMap((batch) => batch.blocks)).toEqual(
      blocksFromMdast(parseMarkdown(markdown).children),
    )
  })

  it('stops handing over blocks once it is abandoned', async () => {
    const controller = new AbortController()
    const batches: PasteBatch[] = []
    const pending = streamMarkdown(inPageRunner(), SMALL)(
      'A.\n\nB.\n\nC.\n',
      (batch) => {
        batches.push(batch)
        controller.abort()
      },
      controller.signal,
    )
    await expect(pending).rejects.toThrow(/aborted/u)
    expect(batches).toHaveLength(1)
  })

  it('fails when a piece cannot be parsed anywhere', async () => {
    await expect(batchesOf(unparseable, 'A.\n')).rejects.toThrow('out of memory')
  })
})

describe('a pool of parse workers', () => {
  it('builds workers on demand, up to its size, and gives each one piece at a time', async () => {
    const fakes = [fakeWorker(), fakeWorker()]
    let made = 0
    const create = vi.fn<() => WorkerLike>(() => {
      const fake = fakes[made]
      made += 1
      if (fake === undefined) throw new Error('Only two.')
      return fake.worker
    })
    const run = workerPoolRunner(create, 2)
    expect(create).not.toHaveBeenCalled()
    const batches: PasteBatch[] = []
    const pending = streamMarkdown(run, SMALL)(
      'A.\n\nB.\n\nC.\n',
      (batch) => batches.push(batch),
      new AbortController().signal,
    )
    expect(create).toHaveBeenCalledTimes(2)
    const [first, second] = fakes
    if (first === undefined || second === undefined) throw new Error('Two fakes.')
    expect(first.sent).toHaveLength(1)
    expect(second.sent).toHaveLength(1)
    // B answers first, but A comes first.
    second.answer()
    await settled()
    expect(batches).toHaveLength(0)
    first.answer()
    await settled()
    expect(batches).toHaveLength(2)
    // C went to whichever worker was free.
    const third = first.sent.length > 0 ? first : second
    third.answer()
    await pending
    expect(batches).toHaveLength(3)
  })

  it('parses a piece in the page when its worker cannot', async () => {
    const fake = fakeWorker()
    const run = workerPoolRunner(() => fake.worker, 1)
    const pending = batchesOf(run, 'A.\n')
    const job = fake.sent[0]
    fake.answer({ id: job?.id ?? -1, error: 'stand-in refused' })
    expect((await pending).flatMap((batch) => batch.blocks)).toEqual(
      blocksFromMdast(parseMarkdown('A.\n').children),
    )
  })

  it('gives up on a worker that dies, finishing its piece in the page, and builds another', async () => {
    const broken = fakeWorker()
    const replacement = fakeWorker()
    const create = vi
      .fn<() => WorkerLike>()
      .mockReturnValueOnce(broken.worker)
      .mockReturnValueOnce(replacement.worker)
    const run = workerPoolRunner(create, 1)
    const pending = batchesOf(run, 'A.\n')
    broken.fail()
    expect(broken.terminated).toBe(true)
    expect(await pending).toHaveLength(1)

    const next = batchesOf(run, 'B.\n')
    replacement.answer()
    expect(await next).toHaveLength(1)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('parses in the page where no worker can be built at all', async () => {
    const run = workerPoolRunner(() => {
      throw new Error('blocked by policy')
    }, 2)
    expect(await batchesOf(run, 'A.\n\nB.\n')).toHaveLength(2)
  })

  it('does not send a worker the pieces of a paste that was abandoned', async () => {
    const fake = fakeWorker()
    const run = workerPoolRunner(() => fake.worker, 1)
    const controller = new AbortController()
    const pending = streamMarkdown(run, SMALL)('A.\n\nB.\n', () => {}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/u)
    fake.answer()
    await settled()
    expect(fake.sent).toHaveLength(0)
  })

  it('can start a worker ahead of the first paste', () => {
    const create = vi.fn<() => WorkerLike>(() => fakeWorker().worker)
    const run = workerPoolRunner(create, 3)
    run.warm()
    run.warm()
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('when a paste goes wrong', () => {
  it('fails the paste when what takes its blocks cannot', async () => {
    const pending = streamMarkdown(inPageRunner(), SMALL)(
      'A.\n',
      () => {
        throw new Error('nowhere to put it')
      },
      new AbortController().signal,
    )
    await expect(pending).rejects.toThrow('nowhere to put it')
  })

  it('fails a piece in the page that cannot be parsed there either', async () => {
    const job = {
      id: 1,
      text: 'Not a definition.\n',
      line: 0,
      offset: 0,
      borrowed: { before: 1, after: 0 },
      blankLinesBefore: undefined,
    }
    expect(answerChunk(job)).toEqual({ id: 1, error: expect.stringContaining('borrowed') })
    await expect(inPageRunner()(job)).rejects.toThrow('borrowed')
  })

  it('ignores an answer it did not ask for, and a worker that fails with nothing in hand', async () => {
    const fake = fakeWorker()
    const create = vi.fn<() => WorkerLike>(() => fake.worker)
    const run = workerPoolRunner(create, 1)
    const pending = batchesOf(run, 'A.\n')
    const job = fake.sent[0]
    if (job === undefined) throw new Error('A job.')
    fake.answer({ id: job.id + 100, error: 'stray' })
    fake.sent.unshift(job)
    fake.answer()
    expect(await pending).toHaveLength(1)
    // Idle, it fails: it is let go, and the next piece builds another.
    fake.fail()
    expect(fake.terminated).toBe(true)
  })
})

describe("the page's parser", () => {
  it('uses as many workers as the machine has cores to spare, between one and four', () => {
    expect(pasteWorkerCount(1)).toBe(1)
    expect(pasteWorkerCount(4)).toBe(3)
    expect(pasteWorkerCount(32)).toBe(4)
    expect(pasteWorkerCount(undefined)).toBe(1)
  })

  it('parses in the page where there are no workers, as in jsdom', async () => {
    vi.stubGlobal('Worker', undefined)
    const batches: PasteBatch[] = []
    await pageMarkdownParser()(
      '# Title\n',
      (batch) => batches.push(batch),
      new AbortController().signal,
    )
    expect(batches.flatMap((batch) => batch.blocks)).toEqual([
      expect.objectContaining({ type: 'heading' }),
    ])
  })

  it('uses module workers for the page where there are workers', () => {
    const made: { url: string; options: unknown }[] = []
    class FakeWorker {
      constructor(url: URL, options: unknown) {
        made.push({ url: url.href, options })
      }
      postMessage() {}
      addEventListener() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    const parse = pageMarkdownParser()
    expect(pageMarkdownParser()).toBe(parse)
    void parse('# Title\n', () => {}, new AbortController().signal)
    expect(made[0]).toEqual({
      url: expect.stringContaining('markdown-parse.worker.ts'),
      options: { type: 'module' },
    })
  })

  it('starts a worker ahead of the first paste only where there are workers', () => {
    vi.stubGlobal('Worker', undefined)
    expect(() => {
      warmMarkdownParser()
    }).not.toThrow()
    const made: string[] = []
    vi.stubGlobal(
      'Worker',
      class {
        constructor(url: URL) {
          made.push(url.href)
        }
        postMessage() {}
        addEventListener() {}
        terminate() {}
      },
    )
    warmMarkdownParser()
    expect(made.length).toBeLessThanOrEqual(1)
  })
})
