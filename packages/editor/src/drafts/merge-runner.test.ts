import { describe, expect, it, vi } from 'vitest'

import { mergeDocuments, parseMarkdown } from '@quill/markdown'
import type { MergeRequest, MergeResponse } from '@quill/markdown/merge-worker'

import type { DocumentAst } from './clients.ts'
import type { MergeWorkerLike } from './merge-runner.ts'
import type { MergeRunner } from './use-draft-reconciliation.ts'
import {
  pageMergeRunner,
  sizedMergeRunner,
  WORKER_BLOCKS,
  workerMergeRunner,
} from './merge-runner.ts'

const base = parseMarkdown('One.\n\nTwo.\n')
const mine = parseMarkdown('One, mine.\n\nTwo.\n')
const theirs = parseMarkdown('One.\n\nTwo, theirs.\n')
const expected = mergeDocuments(base, mine, theirs)

function fakeWorker() {
  const sent: MergeRequest[] = []
  let onMessage: ((event: MessageEvent<MergeResponse>) => void) | undefined
  let onError: (() => void) | undefined
  const worker = {
    terminated: false,
    postMessage: (request: MergeRequest) => {
      sent.push(request)
    },
    addEventListener: (type: 'message' | 'error', listener: never) => {
      if (type === 'message') onMessage = listener
      else onError = listener
    },
    terminate() {
      worker.terminated = true
    },
  }
  return {
    worker: worker as MergeWorkerLike & { terminated: boolean },
    sent,
    answer: (response: MergeResponse) =>
      onMessage?.(new MessageEvent('message', { data: response })),
    fail: () => onError?.(),
  }
}

describe('workerMergeRunner', () => {
  it('builds the worker on first use and answers each merge by its id', async () => {
    const fake = fakeWorker()
    const create = vi.fn<() => MergeWorkerLike>(() => fake.worker)
    const run = workerMergeRunner(create)
    expect(create).not.toHaveBeenCalled()
    const first = run(base, mine, theirs)
    const second = run(base, theirs, mine)
    fake.answer({ id: 7, merge: expected })
    fake.answer({ id: 1, merge: mergeDocuments(base, theirs, mine) })
    fake.answer({ id: 0, merge: expected })
    await expect(first).resolves.toEqual(expected)
    await expect(second).resolves.toEqual(mergeDocuments(base, theirs, mine))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('hands the merges back to the page when the worker dies, and starts a new one next time', async () => {
    const broken = fakeWorker()
    const healthy = fakeWorker()
    const create = vi
      .fn<() => MergeWorkerLike>()
      .mockReturnValueOnce(broken.worker)
      .mockReturnValueOnce(healthy.worker)
    const run = workerMergeRunner(create)
    const pending = run(base, mine, theirs)
    broken.fail()
    expect(broken.worker.terminated).toBe(true)
    await expect(pending).resolves.toEqual(expected)
    void run(base, mine, theirs)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('merges in the page when no worker can be built', async () => {
    const run = workerMergeRunner(() => {
      throw new Error('blocked by policy')
    })
    await expect(run(base, mine, theirs)).resolves.toEqual(expected)
  })
})

describe('sizedMergeRunner', () => {
  const long: DocumentAst = {
    type: 'root',
    children: Array.from({ length: WORKER_BLOCKS + 1 }, () => ({ type: 'thematicBreak' as const })),
  }

  it('sends only long documents to the worker', async () => {
    const large = vi.fn<MergeRunner>(async () => expected)
    const run = sizedMergeRunner(large)
    await expect(run(base, mine, theirs)).resolves.toEqual(expected)
    expect(large).not.toHaveBeenCalled()
    await run(base, long, theirs)
    expect(large).toHaveBeenCalledTimes(1)
  })
})

describe('pageMergeRunner', () => {
  it('merges in the page where there are no workers', async () => {
    vi.stubGlobal('Worker', undefined)
    try {
      await expect(pageMergeRunner()(base, mine, theirs)).resolves.toEqual(expected)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps one runner for the page, building the worker as a module', () => {
    const made: Array<{ url: string; options: unknown }> = []
    vi.stubGlobal(
      'Worker',
      class {
        constructor(url: URL, options: unknown) {
          made.push({ url: String(url), options })
        }
        addEventListener() {}
        postMessage() {}
        terminate() {}
      },
    )
    try {
      const run = pageMergeRunner()
      expect(pageMergeRunner()).toBe(run)
      const long: DocumentAst = {
        type: 'root',
        children: Array.from({ length: WORKER_BLOCKS + 1 }, () => ({
          type: 'thematicBreak' as const,
        })),
      }
      void run(long, long, long)
      expect(made).toEqual([
        { url: expect.stringContaining('merge.worker.ts'), options: { type: 'module' } },
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
