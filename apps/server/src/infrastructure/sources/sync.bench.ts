import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { BRAND } from '@quill/brand'
import { renderDocument, SOURCE_MANIFEST_PATH, syncSource } from '@quill/application'
import type { SyncSourceDependencies } from '@quill/application'
import {
  createFakeClock,
  createFakeIdGenerator,
  createFakeSettings,
  createInMemoryBlobStore,
  createInMemoryUnitOfWork,
  generateSourceCorpus,
  SOURCE_CORPUS_SHAPES,
} from '@quill/application/test-support'
import {
  GitCliExternalSource,
  GitContentStore,
  MemoryObjectStoreProvider,
} from '@quill/content-store'
import { userId, workspaceId } from '@quill/domain'

import { createDrawioText } from '../../extensions/drawio/drawing-text.ts'
import { createHasher } from '../hasher.ts'
import { createDocumentFormat } from '../markdown/document-format.ts'

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
 * ```
 *
 * The remote is what a forge serves: a bare repository, repacked with a
 * reachability bitmap. A working repository that was never repacked makes
 * a partial clone pack every commit and tree on the fly, which measures the
 * remote rather than Quill (ADR-062, "Amendment: the sync's budget"). It is
 * built once per corpus and seed under the system's temporary directory,
 * and kept, so runs compare the same bytes.
 */

/** ADR-062, section 4. XL has no server budget yet: it is measured and reported. */
const BUDGET_MS = { L: { fetch: 4_000, sync: 10_000 }, XL: { fetch: null, sync: null } } as const
const RUNS = 3

const name = process.argv.includes('XL') ? 'XL' : 'L'
const budget = process.argv.includes('--budget')
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
let documents = 0
try {
  for (let run = 0; run < RUNS; run += 1) {
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- runs are measured one at a time
    results.fetch.push(await timed(() => fetchOnce(url, join(scratch, `fetch-${run}`))))
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- as above
    results.sync.push(
      await timed(async () => {
        documents = (await syncOnce(url, join(scratch, `sync-${run}`))).documents
      }),
    )
  }
} finally {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5 })
}

let over = false
process.stdout.write(
  `Sourced workspace budgets, ${name} (${documents} documents), median of ${RUNS} runs\n` +
    'step   wall ms   cpu ms   budget ms\n',
)
for (const step of ['fetch', 'sync'] as const) {
  const runs = results[step]
  const wall = median(runs.map(({ wall: value }) => value))
  const cpu = median(runs.map(({ cpu: value }) => value))
  const limit: number | null = BUDGET_MS[name][step]
  const exceeded = limit !== null && wall > limit
  if (exceeded) over = true
  const cells = [step.padEnd(6), Math.round(wall), Math.round(cpu), limit ?? '-'].map((cell) =>
    String(cell).padStart(8),
  )
  process.stdout.write(`${cells.join(' ')}${exceeded ? '  over' : ''}\n`)
}
if (budget && over) process.exitCode = 1
