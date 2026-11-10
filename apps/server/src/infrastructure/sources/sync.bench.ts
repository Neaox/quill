import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { BRAND } from '@quill/brand'
import { renderDocument, SOURCE_MANIFEST_PATH, syncSource } from '@quill/application'
import type { DocumentWork, SyncSourceDependencies } from '@quill/application'
import {
  createFakeClock,
  createFakeIdGenerator,
  createFakeSettings,
  createInMemoryBlobStore,
  createInMemoryUnitOfWork,
  generateSourceCorpus,
  SOURCE_CORPUS_SHAPES,
} from '@quill/application/test-support'
import { parseDocument } from '@quill/markdown'
import {
  GitCliExternalSource,
  GitContentStore,
  MemoryObjectStoreProvider,
} from '@quill/content-store'
import { userId, workspaceId } from '@quill/domain'

import { createDrawioText } from '../../extensions/drawio/drawing-text.ts'
import { createHasher } from '../hasher.ts'
import { createDocumentFormat } from '../markdown/document-format.ts'
import {
  BUILT_DOCUMENT_WORKER,
  createDocumentWorkPool,
  documentWorkerModule,
} from '../markdown/document-work-pool.ts'

/**
 * ADR-062's server budgets for a sourced workspace, measured on a generated
 * corpus (`generateSourceCorpus`):
 *
 * - **fetch**: opening the source and fetching it from a local `file://`
 *   bare repository, narrowing to the manifest's paths, and reading every
 *   file under them;
 * - **sync**: a first sync of the head (`history: head`) from the same
 *   remote, fetch included, with every document published and then rendered
 *   as the outbox renders it.
 *
 * ```
 * pnpm --filter @quill/server bench:sync              # L, three runs, medians
 * pnpm --filter @quill/server bench:sync -- XL        # the 5,000-file corpus
 * pnpm --filter @quill/server bench:sync -- --budget  # exit 1 when a median is over
 * pnpm --filter @quill/server bench:sync -- --no-pool # the sync on one thread
 * pnpm --filter @quill/server bench:sync -- --jobs 4  # a pool of four threads
 * ```
 *
 * The remote is what a forge serves: a bare repository, repacked with a
 * reachability bitmap. A working repository that was never repacked makes
 * a partial clone pack every commit and tree on the fly, which measures the
 * remote rather than Quill (ADR-062, "Amendment: the sync's budget"). It is
 * built once per corpus and seed under the system's temporary directory,
 * and kept, so runs compare the same bytes.
 */

/**
 * ADR-062, section 4: wall time and CPU time in milliseconds, and the parser's
 * single-thread throughput in MB a second. XL has no server budget yet: it is
 * measured and reported. A null is reported and not held to anything.
 */
const BUDGETS: Readonly<
  Record<
    'L' | 'XL',
    {
      readonly fetch: { readonly wall: number | null; readonly cpu: number | null }
      readonly sync: { readonly wall: number | null; readonly cpu: number | null }
      readonly parseMBps: number | null
    }
  >
> = {
  L: { fetch: { wall: 4_000, cpu: null }, sync: { wall: 10_000, cpu: null }, parseMBps: null },
  XL: { fetch: { wall: null, cpu: null }, sync: { wall: null, cpu: null }, parseMBps: null },
}
const RUNS = 3

const name = process.argv.includes('XL') ? 'XL' : 'L'
const budget = process.argv.includes('--budget')
const jobs = process.argv.indexOf('--jobs')
/** `--no-pool` measures the sync on one thread, as a process without the pool runs it. */
const threads = process.argv.includes('--no-pool')
  ? undefined
  : createDocumentWorkPool({
      extensions: createDocumentFormat().extensions ?? '',
      ...(jobs === -1 ? {} : { size: Number(process.argv[jobs + 1]) }),
    })

/** How long each run spent waiting on the pool's batches, by kind: the rest is the calling thread's. */
const batches = { inspect: 0, render: 0 }
async function spent<T>(kind: keyof typeof batches, work: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try {
    return await work()
  } finally {
    batches[kind] += performance.now() - started
  }
}
const pool: DocumentWork | undefined =
  threads === undefined
    ? undefined
    : {
        inspect: (markdowns) => spent('inspect', () => threads.inspect(markdowns)),
        render: (inputs) => spent('render', () => threads.render(inputs)),
      }
// The production path: threads load the built module, so a thread starting is not a compile.
if (threads !== undefined && documentWorkerModule().href !== BUILT_DOCUMENT_WORKER.href) {
  throw new Error(
    'Build the server first (pnpm --filter @quill/server build): the pool runs the built worker.',
  )
}
const shape = SOURCE_CORPUS_SHAPES[name]
const NOW = new Date('2026-11-11T12:00:00.000Z')
const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Ada Author',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Cy Committer',
      GIT_COMMITTER_EMAIL: 'cy@example.com',
      GIT_AUTHOR_DATE: '2026-11-01T09:00:00Z',
      GIT_COMMITTER_DATE: '2026-11-01T09:00:00Z',
    },
  }).trim()
}

/** The corpus as a bare repository with one commit, repacked as a forge keeps one. */
async function remote(): Promise<string> {
  const root = join(tmpdir(), `${BRAND.slug}-bench-sync-${name}`)
  const bare = join(root, 'remote.git')
  if (!existsSync(join(bare, 'HEAD'))) {
    const corpus = generateSourceCorpus(shape)
    const work = join(root, 'work')
    await rm(root, { recursive: true, force: true, maxRetries: 5 })
    await mkdir(work, { recursive: true })
    git(work, ['init', '--quiet', '--initial-branch=main'])
    git(work, ['config', 'core.autocrlf', 'false'])
    for (const [path, contents] of corpus.files) {
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- a one-off build of the remote
      await mkdir(dirname(join(work, path)), { recursive: true })
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- as above
      await writeFile(join(work, path), contents)
    }
    git(work, ['add', '--all'])
    git(work, ['commit', '--quiet', '--no-verify', '-m', `The ${name} corpus`])
    git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
    git(work, ['push', '--quiet', bare, 'HEAD:refs/heads/main'])
    git(bare, ['config', 'uploadpack.allowFilter', 'true'])
    git(bare, ['repack', '-adq', '--write-bitmap-index'])
  }
  return pathToFileURL(bare).href
}

async function open(url: string, cache: string): Promise<GitCliExternalSource> {
  return await GitCliExternalSource.open({
    remote: url,
    branch: 'main',
    paths: [SOURCE_MANIFEST_PATH],
    strictPrefixes: false,
    cacheDirectory: cache,
    outboundPolicy: { check: async () => ({ allowed: true }) },
    allowFileRemotesForTesting: true,
  })
}

interface Timing {
  readonly wall: number
  readonly cpu: number
}

async function timed(work: () => Promise<void>): Promise<Timing> {
  const cpu = process.cpuUsage()
  const started = performance.now()
  await work()
  const used = process.cpuUsage(cpu)
  return { wall: performance.now() - started, cpu: (used.user + used.system) / 1000 }
}

/** Fetching alone: the clone, the narrowing to the manifest's paths, and every file read. */
async function fetchOnce(url: string, cache: string): Promise<void> {
  const source = await open(url, cache)
  const head = await source.fetch()
  const manifest = await source.file(head, SOURCE_MANIFEST_PATH)
  if (manifest === null) throw new Error('The corpus has no manifest.')
  const collections = generateSourceCorpus(shape).files.get(SOURCE_MANIFEST_PATH)
  if (typeof collections !== 'string') throw new Error('The manifest is not text.')
  const paths = [...collections.matchAll(/path: ([^,}\s]+)/gu)].map((match) => match[1] ?? '')
  await source.narrow([SOURCE_MANIFEST_PATH, ...paths, 'docs/assets'])
  const files = []
  for await (const file of source.files(head)) files.push(file)
  for await (const content of source.readFiles(files.map((file) => file.fileId))) void content
}

/** A first sync of the head, fetch included, then every document rendered as the outbox renders it. */
async function syncOnce(url: string, cache: string): Promise<{ readonly documents: number }> {
  const uow = createInMemoryUnitOfWork()
  const clock = createFakeClock(NOW)
  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Handbook',
    slug: 'handbook',
    now: NOW,
  })
  await uow.repos.workspaceSources.put({
    workspaceId: WORKSPACE,
    remote: 'https://github.com/acme/handbook.git',
    branch: 'main',
    collections: [],
    history: 'head',
    commitMessages: 'subject',
    manifestEntry: null,
    credential: null,
    outsideLinks: 'forge',
    viewTemplate: null,
    webhookSecretName: null,
    configuredBy: userId('00000000-0000-4000-8000-0000000000a1'),
    now: NOW,
  })
  const source = await open(url, cache)
  const contentStore = new GitContentStore({
    provider: new MemoryObjectStoreProvider(),
    now: () => clock.now(),
    random: () => 0.5,
  })
  const format = createDocumentFormat()
  const blobStore = createInMemoryBlobStore()
  const deps: SyncSourceDependencies = {
    uow,
    contentStore,
    format,
    sources: {
      forWorkspace: async () => ({
        source,
        settings: {
          collections: [],
          history: 'head',
          commitMessages: 'subject',
          manifestEntry: null,
        },
        configuredAt: NOW,
      }),
      withDraft: async () => {
        throw new Error('Not asked for in a sync.')
      },
    },
    lock: {
      withLock: async (_, work) => ({ kind: 'ran', value: await work() }),
      isHeld: async () => false,
    },
    clock,
    ids: createFakeIdGenerator('5eed'),
    blobStore,
    drawingText: createDrawioText(),
    maxAssetBytes: 10 * 1024 * 1024,
    ...(pool === undefined
      ? {}
      : { work: { pool, hasher: createHasher(), settings: createFakeSettings() } }),
  }
  const result = await syncSource(deps, { workspaceId: WORKSPACE })
  if (result.kind !== 'synced') throw new Error(`The sync ended ${result.kind}.`)
  const documents = await uow.repos.documents.listByWorkspace(WORKSPACE)
  const renderDeps = {
    uow,
    contentStore,
    format,
    clock,
    ids: createFakeIdGenerator('7e57'),
    hasher: createHasher(),
    blobStore,
    settings: createFakeSettings(),
  }
  for (const document of documents) {
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one render at a time, as one outbox consumer renders
    await renderDocument(renderDeps, { documentId: document.id })
  }
  return { documents: documents.length }
}

const median = (values: readonly number[]): number =>
  values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0

const url = await remote()
const scratch = await mkdtemp(join(tmpdir(), `${BRAND.slug}-bench-run-`))
const results: Record<'fetch' | 'sync', Timing[]> = { fetch: [], sync: [] }
const spans: (typeof batches)[] = []
let documents = 0
try {
  for (let run = 0; run < RUNS; run += 1) {
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- runs are measured one at a time
    results.fetch.push(await timed(() => fetchOnce(url, join(scratch, `fetch-${run}`))))
    batches.inspect = 0
    batches.render = 0
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- as above
    results.sync.push(
      await timed(async () => {
        documents = (await syncOnce(url, join(scratch, `sync-${run}`))).documents
      }),
    )
    spans.push({ ...batches })
  }
} finally {
  await threads?.close()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5 })
}

/** The parser's single-thread throughput over the corpus, the JIT warm: CPU time, median of three. */
function parseThroughput(): number {
  const corpus = generateSourceCorpus(shape)
  const texts = [...corpus.files.values()].filter((value) => typeof value === 'string')
  const pass = (): number => {
    const before = process.cpuUsage()
    for (const text of texts) parseDocument(text)
    const used = process.cpuUsage(before)
    return (used.user + used.system) / 1000
  }
  pass()
  const ms = median([pass(), pass(), pass()])
  return corpus.markdownBytes / 1e6 / (ms / 1000)
}

let over = false
const lines = [
  `Sourced workspace budgets, ${name} (${documents} documents, ${threads === undefined ? 'one thread' : `a pool of ${threads.size} threads`}), median of ${RUNS} runs`,
  'step       wall ms    cpu ms   wall budget   cpu budget',
]
for (const step of ['fetch', 'sync'] as const) {
  const runs = results[step]
  const wall = median(runs.map(({ wall: value }) => value))
  const cpu = median(runs.map(({ cpu: value }) => value))
  const limits = BUDGETS[name][step]
  const exceeded =
    (limits.wall !== null && wall > limits.wall) || (limits.cpu !== null && cpu > limits.cpu)
  if (exceeded) over = true
  const cells = [Math.round(wall), Math.round(cpu), limits.wall ?? '-', limits.cpu ?? '-']
  lines.push(
    `${step.padEnd(8)}${cells.map((cell) => String(cell).padStart(10)).join('  ')}${exceeded ? '  over' : ''}`,
  )
}
const throughput = parseThroughput()
const floor = BUDGETS[name].parseMBps
const slow = floor !== null && throughput < floor
if (slow) over = true
lines.push(
  `parse, one thread: ${throughput.toFixed(2)} MB/s (budget ${floor === null ? '-' : `at least ${floor}`})${slow ? '  under' : ''}`,
)
if (threads !== undefined) {
  const starts = threads.startups()
  const inspect = median(spans.map((span) => span.inspect))
  const render = median(spans.map((span) => span.render))
  const wall = median(results.sync.map((run) => run.wall))
  lines.push(
    `sync on the pool: inspect ${Math.round(inspect)} ms, render ${Math.round(render)} ms; the rest, on the calling thread: ${Math.round(wall - inspect - render)} ms`,
    `worker start, built module: median ${Math.round(median(starts))} ms, longest ${Math.round(Math.max(0, ...starts))} ms, ${starts.length} starts`,
  )
}
process.stdout.write(`${lines.join('\n')}\n`)
if (budget && over) process.exitCode = 1
