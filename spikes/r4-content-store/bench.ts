/**
 * R4 benchmark. Reproduces every number in docs/research/r04-content-store.md.
 *
 *   node bench.ts                      # default: 1000 and 10000 docs, 20000 commits
 *   node bench.ts --docs 1000
 *   node bench.ts --docs 10000 --commits 20000
 *   node bench.ts --engine iso         # isomorphic-git instead of the hand-written core
 *   node bench.ts --out results.json
 *
 * Everything is written to a temp directory and deleted unless --keep.
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ContentStore, type ContentChange } from './src/content-store.ts'
import { makeDoc } from './src/corpus.ts'
import { FsObjectStore } from './src/fs-store.ts'
import { CachingObjectStore } from './src/memory-store.ts'
import { buildTreeFromPaths, writeBlob, writeCommit } from './src/git-core.ts'
import { IsoContentStore } from './src/isogit-store.ts'

// ------------------------------------------------------------------ args

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? dflt : (argv[i + 1] as string)
}
const flag = (name: string): boolean => argv.includes(`--${name}`)

const DOC_COUNTS = arg('docs', '1000,10000').split(',').map(Number)
const COMMIT_TARGET = Number(arg('commits', '20000'))
const SAMPLES = Number(arg('samples', '300'))
const ENGINE = arg('engine', 'own')
const KEEP = flag('keep')
const OUT = arg('out', '')

// ------------------------------------------------------------- utilities

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i] as number
}

interface Stat {
  n: number
  p50: number
  p95: number
  p99: number
  max: number
  mean: number
}

function stats(samples: number[]): Stat {
  const s = [...samples].sort((a, b) => a - b)
  const sum = s.reduce((a, b) => a + b, 0)
  return {
    n: s.length,
    p50: +pct(s, 50).toFixed(3),
    p95: +pct(s, 95).toFixed(3),
    p99: +pct(s, 99).toFixed(3),
    max: +(s[s.length - 1] ?? 0).toFixed(3),
    mean: +(sum / (s.length || 1)).toFixed(3),
  }
}

async function dirSize(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  const walk = async (d: string): Promise<void> => {
    const entries = await fs.readdir(d, { withFileTypes: true })
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else {
        const st = await fs.stat(p)
        bytes += st.size
        files++
      }
    }
  }
  await walk(dir)
  return { bytes, files }
}

const mb = (b: number): number => +(b / 1024 / 1024).toFixed(1)

function git(gitdir: string, args: string[]): string {
  return execFileSync('git', ['--git-dir', gitdir, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

function timeCli(gitdir: string, args: string[], runs = 5): Stat {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    git(gitdir, args)
    samples.push(performance.now() - t)
  }
  return stats(samples)
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

// ---------------------------------------------------------------- phases

interface Result {
  engine: string
  docs: number
  commits: number
  import: { ms: number; bytes: number }
  publish: Record<string, Stat>
  read: Stat
  historyPath: Stat
  historyPathCached: Stat
  historyDocId: Stat
  historyDocIdScan200: Stat
  cliLogPath: Stat | null
  diff: Stat
  rebuildIndexMs: number | null
  size: {
    looseBytes: number
    looseFiles: number
    packedBytes: number | null
    packedFiles: number | null
    gcMs: number | null
  }
}

async function run(docs: number, root: string): Promise<Result> {
  const gitdir = path.join(root, `bench-${ENGINE}-${docs}.git`)
  console.log(`\n=== engine=${ENGINE} docs=${docs} ===`)

  const result: Result = {
    engine: ENGINE,
    docs,
    commits: 0,
    import: { ms: 0, bytes: 0 },
    publish: {},
    read: stats([]),
    historyPath: stats([]),
    historyPathCached: stats([]),
    historyDocId: stats([]),
    historyDocIdScan200: stats([]),
    cliLogPath: null,
    diff: stats([]),
    rebuildIndexMs: null,
    size: {
      looseBytes: 0,
      looseFiles: 0,
      packedBytes: null,
      packedFiles: null,
      gcMs: null,
    },
  }

  // ---- phase 1: bulk import, one commit (ADR-015 bulk semantics)
  const store = await FsObjectStore.init(gitdir)
  let t0 = performance.now()
  const files = new Map<string, string>()
  for (let i = 0; i < docs; i++) {
    const d = makeDoc(i, 0)
    files.set(d.path, await writeBlob(store, Buffer.from(d.content, 'utf8')))
  }
  const tree = await buildTreeFromPaths(store, files)
  const when = 1_757_000_000
  const root0 = await writeCommit(store, {
    tree,
    parents: [],
    author: { name: 'Importer', email: 'import@example.com', when, tz: '+0000' },
    committer: { name: 'Quill', email: 'quill@quill.invalid', when, tz: '+0000' },
    message: `Import ${docs} documents\n\nQuill-Change-Note: bulk import\n`,
  })
  await store.casRef('refs/heads/main', null, root0)
  result.import.ms = +(performance.now() - t0).toFixed(1)
  result.commits = 1
  console.log(`import ${docs} docs in one commit: ${result.import.ms} ms`)

  const cs = ENGINE === 'iso' ? new IsoContentStore(gitdir) : new ContentStore(store)

  // ---- phase 2: publish latency at this repository size
  const measurePublish = async (label: string, n: number): Promise<Stat> => {
    const samples: number[] = []
    let head = await cs.head()
    for (let k = 0; k < n; k++) {
      const i = (k * 7919) % docs // spread across directories
      const c = change(i, 1000 + k)
      const t = performance.now()
      const r = await cs.publish(c, head)
      samples.push(performance.now() - t)
      head = r.revision
      result.commits++
    }
    const s = stats(samples)
    result.publish[label] = s
    console.log(
      `publish ${label}: p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms max=${s.max}ms (n=${s.n})`,
    )
    return s
  }

  await measurePublish('warm-up', 30)
  delete result.publish['warm-up']
  await measurePublish(`at ${docs} docs, ~${result.commits} commits`, SAMPLES)

  // ---- phase 3: grow the history to COMMIT_TARGET commits
  if (COMMIT_TARGET > result.commits) {
    const need = COMMIT_TARGET - result.commits
    console.log(`growing history by ${need} commits...`)
    t0 = performance.now()
    let head = await cs.head()
    for (let k = 0; k < need; k++) {
      const i = (k * 7919) % docs
      const r = await cs.publish(change(i, 2000 + k), head)
      head = r.revision
      result.commits++
      if ((k + 1) % 5000 === 0) {
        console.log(
          `  ${k + 1}/${need} commits, ${((performance.now() - t0) / (k + 1)).toFixed(2)} ms/commit`,
        )
      }
    }
    console.log(
      `  grew to ${result.commits} commits in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    )
    await measurePublish(`at ${docs} docs, ${result.commits} commits`, SAMPLES)
  }

  // ---- phase 4: read
  {
    const samples: number[] = []
    for (let k = 0; k < 200; k++) {
      const i = (k * 104729) % docs
      const t = performance.now()
      await cs.read(makeDoc(i, 0).path)
      samples.push(performance.now() - t)
    }
    result.read = stats(samples)
    console.log(`read(path, HEAD): p50=${result.read.p50}ms p95=${result.read.p95}ms`)
  }

  // ---- phase 5: history
  {
    const samples: number[] = []
    const runs = result.commits > 5000 ? 3 : 20
    for (let k = 0; k < runs; k++) {
      const i = (k * 104729) % docs
      const t = performance.now()
      const h =
        cs instanceof ContentStore
          ? await cs.history(makeDoc(i, 0).path, { limit: 20 })
          : await (cs as IsoContentStore).history(makeDoc(i, 0).path, 20)
      samples.push(performance.now() - t)
      if (k === 0) console.log(`  (history returned ${h.length} revisions)`)
    }
    result.historyPath = stats(samples)
    console.log(
      `history(path) full walk: p50=${result.historyPath.p50}ms p95=${result.historyPath.p95}ms`,
    )
  }

  // same walk, but with an in-process tree/commit cache in front of the store
  if (cs instanceof ContentStore) {
    const cached = new ContentStore(new CachingObjectStore(store, 200_000))
    const samples: number[] = []
    const runs = result.commits > 5000 ? 3 : 20
    for (let k = 0; k < runs; k++) {
      const i = (k * 104729) % docs
      const t = performance.now()
      await cached.history(makeDoc(i, 0).path, { limit: 20 })
      samples.push(performance.now() - t)
    }
    result.historyPathCached = stats(samples)
    console.log(
      `history(path) with object cache: p50=${result.historyPathCached.p50}ms p95=${result.historyPathCached.p95}ms`,
    )
  }

  if (cs instanceof ContentStore) {
    const samples: number[] = []
    for (let k = 0; k < 3; k++) {
      const i = (k * 104729) % docs
      const t = performance.now()
      await cs.historyByDocumentId(makeDoc(i, 0).id, { limit: 20 })
      samples.push(performance.now() - t)
    }
    result.historyDocId = stats(samples)
    console.log(
      `historyByDocumentId (trailer scan): p50=${result.historyDocId.p50}ms p95=${result.historyDocId.p95}ms`,
    )

    const s2: number[] = []
    for (let k = 0; k < 50; k++) {
      const i = (k * 104729) % docs
      const t = performance.now()
      await cs.historyByDocumentId(makeDoc(i, 0).id, { limit: 20, scanLimit: 200 })
      s2.push(performance.now() - t)
    }
    result.historyDocIdScan200 = stats(s2)
    console.log(
      `historyByDocumentId capped at 200 commits: p50=${result.historyDocIdScan200.p50}ms p95=${result.historyDocIdScan200.p95}ms`,
    )
  }

  // git CLI baseline for the same question
  result.cliLogPath = timeCli(
    gitdir,
    ['log', '--format=%H', '-n', '20', '--', makeDoc(1, 0).path],
    3,
  )
  console.log(`git CLI  log -n20 -- <path>: p50=${result.cliLogPath.p50}ms`)

  // ---- phase 6: diff
  if (cs instanceof ContentStore) {
    const head = (await cs.head()) as string
    const hist = await cs.history(makeDoc(0, 0).path, { limit: 3 })
    const samples: number[] = []
    if (hist.length >= 2) {
      for (let k = 0; k < 100; k++) {
        const t = performance.now()
        await cs.diff(
          (hist[1] as { revision: string }).revision,
          (hist[0] as { revision: string }).revision,
          makeDoc(0, 0).path,
        )
        samples.push(performance.now() - t)
      }
    }
    void head
    result.diff = stats(samples)
    console.log(`diff(revA, revB, path): p50=${result.diff.p50}ms p95=${result.diff.p95}ms`)
  }

  // ---- phase 7: rebuild the revisions index from the repository alone
  if (cs instanceof ContentStore && result.commits <= 25_000) {
    const t = performance.now()
    const index = await cs.rebuildIndex()
    result.rebuildIndexMs = +(performance.now() - t).toFixed(1)
    console.log(
      `rebuildIndex over ${result.commits} commits: ${result.rebuildIndexMs} ms (${index.size} documents)`,
    )
  }

  // ---- phase 8: size on disk
  const loose = await dirSize(gitdir)
  result.size.looseBytes = loose.bytes
  result.size.looseFiles = loose.files
  console.log(`size (loose objects): ${mb(loose.bytes)} MB in ${loose.files} files`)

  const tgc = performance.now()
  git(gitdir, ['gc', '--quiet', '--prune=now'])
  result.size.gcMs = +(performance.now() - tgc).toFixed(0)
  const packed = await dirSize(gitdir)
  result.size.packedBytes = packed.bytes
  result.size.packedFiles = packed.files
  console.log(
    `size (after git gc): ${mb(packed.bytes)} MB in ${packed.files} files, gc took ${(result.size.gcMs / 1000).toFixed(1)} s`,
  )

  // sanity: still readable by the CLI and by us
  const fsck = git(gitdir, ['fsck', '--strict', '--no-dangling', '--no-progress'])
  console.log(`git fsck --strict: ${fsck.trim() === '' ? 'clean' : fsck.trim().slice(0, 200)}`)
  const store2 = new FsObjectStore(gitdir)
  const cs2 = new ContentStore(store2)
  const afterGc = await cs2.read(makeDoc(3, 0).path)
  console.log(`read through packfile after gc: ${afterGc ? 'ok' : 'FAILED'}`)
  const packedPublish = performance.now()
  await cs2.publish(change(3, 9999), await cs2.head())
  console.log(
    `publish on a fully packed repo: ${(performance.now() - packedPublish).toFixed(2)} ms`,
  )

  return result
}

// ------------------------------------------------------------------ main

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-bench-'))
console.log(
  `machine: ${os.cpus()[0]?.model.trim()} / ${os.cpus().length} threads / ${Math.round(os.totalmem() / 2 ** 30)} GB`,
)
console.log(`node ${process.version}, ${os.platform()} ${os.release()}`)
console.log(`git ${execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()}`)
console.log(`workdir: ${root}`)

const results: Result[] = []
for (const docs of DOC_COUNTS) {
  results.push(await run(docs, root))
}

if (OUT) {
  await fs.writeFile(OUT, JSON.stringify({ when: new Date().toISOString(), results }, null, 2))
  console.log(`\nwrote ${OUT}`)
}

console.log('\n--- summary ---')
for (const r of results) {
  console.log(
    `${r.engine} ${r.docs} docs / ${r.commits} commits: ` +
      Object.entries(r.publish)
        .map(([k, v]) => `[${k}] p50=${v.p50} p95=${v.p95}`)
        .join('  ') +
      `  loose=${mb(r.size.looseBytes)}MB packed=${mb(r.size.packedBytes ?? 0)}MB`,
  )
}

if (!KEEP) await fs.rm(root, { recursive: true, force: true })
else console.log(`kept: ${root}`)
