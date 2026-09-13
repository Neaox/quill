/**
 * Where does a publish spend its time, and how much of it is Windows file I/O
 * rather than the object model?  node profile.ts [--dir <path>]
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ContentStore, type ContentChange } from './src/content-store.ts'
import { makeDoc } from './src/corpus.ts'
import { FsObjectStore } from './src/fs-store.ts'
import {
  buildTreeFromPaths,
  readCommit,
  setPath,
  writeBlob,
  writeCommit,
  type ObjectStore,
} from './src/git-core.ts'
import { CachingObjectStore, MemoryObjectStore } from './src/memory-store.ts'

const DOCS = 1000
const N = 300
const when = 1_757_000_000

const argv = process.argv.slice(2)
const dirArg = argv.indexOf('--dir')
const base = dirArg === -1 ? os.tmpdir() : (argv[dirArg + 1] as string)

async function seed(store: ObjectStore): Promise<string> {
  const files = new Map<string, string>()
  for (let i = 0; i < DOCS; i++) {
    const d = makeDoc(i, 0)
    files.set(d.path, await writeBlob(store, Buffer.from(d.content, 'utf8')))
  }
  const tree = await buildTreeFromPaths(store, files)
  const c0 = await writeCommit(store, {
    tree,
    parents: [],
    author: { name: 'I', email: 'i@e.com', when, tz: '+0000' },
    committer: { name: 'Quill', email: 'q@e.com', when, tz: '+0000' },
    message: 'import\n',
  })
  await store.casRef('refs/heads/main', null, c0)
  return c0
}

async function breakdown(label: string, store: ObjectStore): Promise<void> {
  const c0 = await seed(store)
  const acc: Record<string, number> = {}
  const time = async <T>(k: string, f: () => Promise<T>): Promise<T> => {
    const t = performance.now()
    const r = await f()
    acc[k] = (acc[k] ?? 0) + (performance.now() - t)
    return r
  }
  let head = c0
  const t0 = performance.now()
  for (let k = 0; k < N; k++) {
    const d = makeDoc((k * 7919) % DOCS, 5000 + k)
    const blob = await time('writeBlob', () => writeBlob(store, Buffer.from(d.content, 'utf8')))
    const h = await time('readRef', () => store.readRef('refs/heads/main'))
    const commit = await time('readCommit', () => readCommit(store, h as string))
    const newTree = await time('setPath (tree read+write)', () =>
      setPath(store, commit.tree, d.path, blob),
    )
    const oid = await time('writeCommit', () =>
      writeCommit(store, {
        tree: newTree,
        parents: [head],
        author: { name: 'U', email: 'u@e.com', when, tz: '+0000' },
        committer: { name: 'Quill', email: 'q@e.com', when, tz: '+0000' },
        message: `Update\n\nQuill-Document-Id: ${d.id}\n`,
      }),
    )
    await time('casRef', () => store.casRef('refs/heads/main', head, oid))
    head = oid
  }
  const total = performance.now() - t0
  console.log(
    `\n${label}: ${N} publishes in ${total.toFixed(0)} ms = ${(total / N).toFixed(2)} ms each`,
  )
  for (const [k, v] of Object.entries(acc).sort((a, b) => b[1] - a[1])) {
    console.log(
      `  ${k.padEnd(26)} ${(v / N).toFixed(3)} ms/publish  ${((v / total) * 100).toFixed(0)}%`,
    )
  }
}

const root = await fs.mkdtemp(path.join(base, 'r4-prof-'))
console.log(`repos under: ${root}`)

await breakdown('A  loose objects on disk', await FsObjectStore.init(path.join(root, 'a.git')))
await breakdown(
  'B  loose objects + tree/commit read cache',
  new CachingObjectStore(await FsObjectStore.init(path.join(root, 'b.git'))),
)
const mem = new MemoryObjectStore()
await breakdown('C  in-memory objects (engine cost only)', mem)

// Round trips a Postgres/S3 backend would make per publish.
mem.resetCounters()
const cs = new ContentStore(mem)
let head = await cs.head()
for (let k = 0; k < 100; k++) {
  const d = makeDoc((k * 7919) % DOCS, 7000 + k)
  const c: ContentChange = {
    documentId: d.id,
    path: d.path,
    content: d.content,
    title: d.title,
    author: { name: 'U', email: 'u@e.com' },
  }
  head = (await cs.publish(c, head)).revision
}
console.log(
  `\nper publish, against a key/value backend: ${(mem.reads / 100).toFixed(1)} object reads, ` +
    `${(mem.writes / 100).toFixed(1)} object writes, ${(mem.refReads / 100).toFixed(1)} ref reads, ` +
    `${(mem.casAttempts / 100).toFixed(1)} CAS`,
)
console.log(
  `object store after ${DOCS} docs + ${N + 100} publishes: ${mem.objectCount} objects, ` +
    `${(mem.byteCount / 1024 / 1024).toFixed(1)} MB uncompressed`,
)

await fs.rm(root, { recursive: true, force: true })
