/**
 * Why does publish slow down at 10,000 documents and 20,000 commits?
 *
 *   node scale-check.ts [--docs 10000] [--commits 20000]
 *
 * `bench.ts` measured p50 10.96 ms at 10,000 docs / 31 commits and
 * p50 71.17 ms at 10,000 docs / 20,000 commits, while the same growth at
 * 1,000 docs stayed flat at ~10.5 ms. Three candidate causes:
 *
 *   (a) the object model degrades with repository or history size,
 *   (b) the loose-object directory degrades as files accumulate,
 *   (c) contamination — the bench ran both sizes in one process and one
 *       temp volume, so the second run started with ~143,000 stale files
 *       beside it and a warm-but-large heap.
 *
 * This runs each case in a FRESH process, a FRESH temp root, and measures
 * publish latency at intervals while the repository grows — against the
 * filesystem, against an in-memory store, and against a cached filesystem
 * store. (a) is disproved if the memory line stays flat.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ContentStore, type ContentChange } from './src/content-store.ts'
import { makeDoc } from './src/corpus.ts'
import { FsObjectStore } from './src/fs-store.ts'
import { buildTreeFromPaths, writeBlob, writeCommit, type ObjectStore } from './src/git-core.ts'
import { CachingObjectStore, MemoryObjectStore } from './src/memory-store.ts'

const argv = process.argv.slice(2)
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? d : (argv[i + 1] as string)
}
const DOCS = Number(arg('docs', '10000'))
const COMMITS = Number(arg('commits', '20000'))
const SAMPLE_EVERY = Number(arg('every', '2000'))
const WHICH = arg('store', 'fs,cached,memory').split(',')

const pct = (s: number[], p: number): number => {
  const a = [...s].sort((x, y) => x - y)
  return +(a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)] as number).toFixed(2)
}

const change = (i: number, rev: number): ContentChange => {
  const d = makeDoc(i, rev)
  return {
    documentId: d.id,
    path: d.path,
    content: d.content,
    title: d.title,
    changeNote: `Revision ${rev}`,
    author: { name: `User ${i % 37}`, email: `user${i % 37}@example.com` },
  }
}

async function seed(store: ObjectStore): Promise<string> {
  const files = new Map<string, string>()
  for (let i = 0; i < DOCS; i++) {
    const d = makeDoc(i, 0)
    files.set(d.path, await writeBlob(store, Buffer.from(d.content, 'utf8')))
  }
  const tree = await buildTreeFromPaths(store, files)
  const when = 1_757_000_000
  const c0 = await writeCommit(store, {
    tree,
    parents: [],
    author: { name: 'Importer', email: 'import@example.com', when, tz: '+0000' },
    committer: { name: 'Quill', email: 'quill@quill.invalid', when, tz: '+0000' },
    message: `Import ${DOCS} documents\n`,
  })
  await store.casRef('refs/heads/main', null, c0)
  return c0
}

async function curve(label: string, store: ObjectStore): Promise<void> {
  console.log(`\n--- ${label}: ${DOCS} docs, growing to ${COMMITS} commits ---`)
  await seed(store)
  const cs = new ContentStore(store)
  let head = await cs.head()
  let window: number[] = []
  const t0 = performance.now()
  for (let k = 0; k < COMMITS; k++) {
    const i = (k * 7919) % DOCS
    const t = performance.now()
    const r = await cs.publish(change(i, 1000 + k), head)
    window.push(performance.now() - t)
    head = r.revision
    if ((k + 1) % SAMPLE_EVERY === 0) {
      console.log(
        `  after ${String(k + 1).padStart(6)} commits: p50=${String(pct(window, 50)).padStart(7)} ms  p95=${String(pct(window, 95)).padStart(7)} ms  (last ${window.length})`,
      )
      window = []
    }
  }
  console.log(`  total ${((performance.now() - t0) / 1000).toFixed(1)} s`)
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-scale-'))
console.log(`node ${process.version}, ${os.platform()} ${os.release()}`)
console.log(`temp root: ${root}`)

if (WHICH.includes('memory')) await curve('in-memory object store', new MemoryObjectStore())
if (WHICH.includes('cached')) {
  await curve(
    'loose objects on disk + tree/commit cache',
    new CachingObjectStore(await FsObjectStore.init(path.join(root, 'cached.git')), 500_000),
  )
}
if (WHICH.includes('fs')) {
  await curve('loose objects on disk', await FsObjectStore.init(path.join(root, 'fs.git')))
}

await fs.rm(root, { recursive: true, force: true })
