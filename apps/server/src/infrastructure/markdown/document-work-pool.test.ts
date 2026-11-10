import { generateSourceCorpus, SOURCE_CORPUS_SHAPES } from '@quill/application/test-support'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { createDocumentFormat } from './document-format.ts'
import { buildDocumentWorker } from './document-work-bundle.ts'
import {
  createDocumentWorkPool,
  defaultPoolSize,
  DOCUMENT_WORKER_SOURCE,
  documentWorkerModule,
  workerManifest,
} from './document-work-pool.ts'
import type { DocumentWorkPool } from './document-work-pool.ts'

const format = createDocumentFormat()
const pools: DocumentWorkPool[] = []
afterEach(async () => {
  await Promise.all(pools.splice(0).map((created) => created.close()))
})

function pool(options: Partial<Parameters<typeof createDocumentWorkPool>[0]> = {}) {
  const created = createDocumentWorkPool({
    extensions: format.extensions ?? '',
    size: 3,
    ...options,
  })
  pools.push(created)
  return created
}

/** A few dozen pages of the generated corpus, of every size it holds. */
const pages = [...generateSourceCorpus(SOURCE_CORPUS_SHAPES.XL).files]
  .flatMap(([path, contents]) =>
    path.endsWith('.md') && typeof contents === 'string' ? [contents] : [],
  )
  .filter((_, index) => index % 125 === 0)

function crashing(times: number) {
  const crashes = new Int32Array(new SharedArrayBuffer(4))
  crashes[0] = times
  return {
    url: new URL('./__fixtures__/crashing-worker.ts', import.meta.url),
    data: { extensions: format.extensions ?? '', crashes },
  }
}

describe('the document work pool', () => {
  it('answers exactly as the format does on this thread, in the order asked', async () => {
    const work = pool()
    const inputs = pages.map((markdown) => ({ markdown, linkTitles: new Map() }))
    expect(await work.render(inputs)).toEqual(inputs.map((input) => format.render(input)))
    expect(await work.inspect(pages)).toEqual(pages.map((page) => format.inspect(page)))
    expect(await work.inspect([])).toEqual([])
  }, 120_000)

  it('renders a text it inspected from the tree the inspection kept, exactly as the format renders it', async () => {
    // One thread: the texts it inspected are its own work, taken before the rest.
    const one = pool({ size: 1 })
    const inputs = pages.map((markdown) => ({ markdown, linkTitles: new Map() }))
    await one.inspect(pages.slice(0, 4))
    expect(await one.render(inputs)).toEqual(inputs.map((input) => format.render(input)))
    // Three threads, each rendering what it inspected, and then the others' work.
    const three = pool()
    await three.inspect(pages)
    expect(await three.render(inputs)).toEqual(inputs.map((input) => format.render(input)))
  }, 120_000)

  it('refuses a thread whose renderer is not the server’s', async () => {
    const work = pool({ extensions: 'another-renderer@1' })
    await expect(work.inspect(['# A'])).rejects.toThrow(/other extensions/u)
  }, 60_000)

  it('tries an item again on a fresh thread when its thread dies, and fails it the second time', async () => {
    const once = pool({ worker: crashing(1) })
    expect((await once.inspect(['a', 'crash', 'b'])).map(({ view }) => view.title)).toEqual([
      'a',
      'crash',
      'b',
    ])
    const always = pool({ worker: crashing(2) })
    await expect(always.inspect(['a', 'crash'])).rejects.toThrow(/stopped twice/u)
    // The pool carries on with fresh threads.
    expect((await always.inspect(['c'])).map(({ view }) => view.title)).toEqual(['c'])
  }, 60_000)

  it('fails a batch whose item the format threw on, or answered with something else', async () => {
    // One thread, so `throw` (the longest) is answered first and `a` after the batch has failed.
    const work = pool({ worker: crashing(0), size: 1 })
    await expect(work.inspect(['a', 'throw'])).rejects.toThrow('The format threw.')
    await expect(work.inspect(['odd'])).rejects.toThrow(/something else/u)
  }, 60_000)

  it('stops its threads when idle, and starts them again for more work', async () => {
    // The machine's own size, and a short idle time.
    const work = createDocumentWorkPool({ extensions: format.extensions ?? '', idleMs: 10 })
    pools.push(work)
    expect(await work.inspect(['# Once'])).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await work.inspect(['# Again'])).toHaveLength(1)
  }, 60_000)

  it('sizes itself to half the machine’s logical cores, between one thread and four', () => {
    expect(pool({ size: 2 }).size).toBe(2)
    expect(defaultPoolSize()).toBeGreaterThanOrEqual(1)
    expect(defaultPoolSize()).toBeLessThanOrEqual(4)
    expect([1, 2, 3, 4, 8, 16].map((cores) => defaultPoolSize(cores))).toEqual([1, 1, 1, 2, 4, 4])
  })
})

describe('the built document worker', () => {
  it('renders exactly as the source does, and is used only while it matches the sources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'document-worker-'))
    try {
      const built = pathToFileURL(join(directory, 'document-work-worker.mjs'))
      await buildDocumentWorker(built)
      expect(documentWorkerModule(built)).toEqual(built)

      const work = pool({ worker: { url: built } })
      const inputs = pages.map((markdown) => ({ markdown, linkTitles: new Map() }))
      expect(await work.render(inputs)).toEqual(inputs.map((input) => format.render(input)))
      // And from the trees its inspections kept.
      await work.inspect(pages)
      expect(await work.render(inputs)).toEqual(inputs.map((input) => format.render(input)))

      // A build from other sources than these is left alone.
      const manifest = workerManifest(built)
      const listed = JSON.parse(await readFile(manifest, 'utf8')) as { readonly sources: string[] }
      await writeFile(manifest, JSON.stringify({ sources: listed.sources, digest: 'stale' }))
      expect(documentWorkerModule(built)).toEqual(DOCUMENT_WORKER_SOURCE)
      await rm(manifest)
      expect(documentWorkerModule(built)).toEqual(DOCUMENT_WORKER_SOURCE)
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5 })
    }
  }, 180_000)
})
