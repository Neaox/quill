import { parseDocument } from '@quill/markdown'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { answerParse, inThreadParser, pageMarkdownParser, workerParser } from './markdown-parser.ts'
import type { ParseRequest, ParseResponse, WorkerLike } from './markdown-parser.ts'

/**
 * A large paste is parsed off the main thread (quill-plan.md section 31: a
 * paste never freezes the tab). The worker is a port: a browser runs the
 * module worker, jsdom has none and parses in the page, and a test drives a
 * fake that answers when told to.
 */

const MARKDOWN = '# A heading\n\nA paragraph.\n'

/** A worker that answers each request with `answerParse`, when the test says so. */
function fakeWorker() {
  const sent: ParseRequest[] = []
  const listeners = {
    message: new Set<(event: MessageEvent<ParseResponse>) => void>(),
    error: new Set<() => void>(),
  }
  let terminated = false
  const worker: WorkerLike = {
    postMessage: (request, _options) => {
      sent.push(request)
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
    answer(response: ParseResponse = answerParse(sent.at(-1) ?? { id: -1, markdown: '' })) {
      for (const listener of listeners.message)
        listener(new MessageEvent('message', { data: response }))
    },
    fail() {
      for (const listener of listeners.error) listener()
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('answering a parse request', () => {
  it('answers with the tree, by id', () => {
    expect(answerParse({ id: 3, markdown: MARKDOWN })).toEqual({
      id: 3,
      ast: parseDocument(MARKDOWN).ast,
    })
  })

  it('answers with the failure rather than throwing it away', () => {
    const response = answerParse({ id: 4, markdown: null as unknown as string })
    expect(response).toEqual({ id: 4, error: expect.any(String) })
  })
})

describe('parsing in the page', () => {
  it('parses after the current task, so the paste can say it has started', async () => {
    const parse = inThreadParser()
    const pending = parse(MARKDOWN)
    await expect(pending).resolves.toEqual(parseDocument(MARKDOWN).ast)
  })
})

describe('parsing in a worker', () => {
  it('builds the worker once, when first asked, and resolves each request by its id', async () => {
    const fake = fakeWorker()
    const create = vi.fn<() => WorkerLike>(() => fake.worker)
    const parse = workerParser(create)
    expect(create).not.toHaveBeenCalled()

    const first = parse('One.\n')
    const second = parse('Two.\n')
    expect(create).toHaveBeenCalledOnce()
    expect(fake.sent.map((request) => request.markdown)).toEqual(['One.\n', 'Two.\n'])

    fake.answer(answerParse(fake.sent[1] ?? { id: -1, markdown: '' }))
    fake.answer(answerParse(fake.sent[0] ?? { id: -1, markdown: '' }))
    // An answer to nothing asked is ignored.
    fake.answer({ id: 99, error: 'stray' })
    await expect(first).resolves.toEqual(parseDocument('One.\n').ast)
    await expect(second).resolves.toEqual(parseDocument('Two.\n').ast)
  })

  it('parses in the page when the worker cannot parse', async () => {
    const fake = fakeWorker()
    const parse = workerParser(() => fake.worker)
    const pending = parse(MARKDOWN)
    fake.answer({ id: fake.sent[0]?.id ?? -1, error: 'out of memory' })
    await expect(pending).resolves.toEqual(parseDocument(MARKDOWN).ast)
  })

  it('gives up on a worker that fails, finishing what it held in the page, and builds another', async () => {
    const broken = fakeWorker()
    const replacement = fakeWorker()
    const create = vi
      .fn<() => WorkerLike>()
      .mockReturnValueOnce(broken.worker)
      .mockReturnValueOnce(replacement.worker)
    const parse = workerParser(create)
    const pending = parse(MARKDOWN)
    broken.fail()
    expect(broken.terminated).toBe(true)
    await expect(pending).resolves.toEqual(parseDocument(MARKDOWN).ast)

    const next = parse('Again.\n')
    replacement.answer()
    await expect(next).resolves.toEqual(parseDocument('Again.\n').ast)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('parses in the page where no worker can be built at all', async () => {
    const parse = workerParser(() => {
      throw new Error('blocked by policy')
    })
    await expect(parse(MARKDOWN)).resolves.toEqual(parseDocument(MARKDOWN).ast)
  })
})

describe("the page's parser", () => {
  it('parses in the page where there are no workers, as in jsdom', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(pageMarkdownParser()(MARKDOWN)).resolves.toEqual(parseDocument(MARKDOWN).ast)
  })

  it('uses one module worker for the page where there are workers', () => {
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
    void parse(MARKDOWN)
    expect(made).toEqual([
      { url: expect.stringContaining('markdown-parse.worker.ts'), options: { type: 'module' } },
    ])
  })
})
