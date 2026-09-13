/**
 * nodegit probe: does it install and run on Node 24, can it write
 * blobs/trees/commits against a BARE repo with no working tree and no index,
 * does it expose compare-and-swap on refs, and can a custom object-database
 * backend (Postgres/S3) be written from JavaScript?
 *
 *   cd probe-nodegit && node probe.ts
 *
 * Kept in its own package because nodegit cannot be installed by pnpm at all
 * (see README) and must not pollute the spike's own node_modules.
 */

import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

const require = createRequire(import.meta.url)
const Git = require('nodegit')

const DOCS = 1000
const N = 200

const LOREM =
  'The content store is the only place published document content lives. ' +
  'It is a Git-compatible object engine used as a library against a bare repository. '

function docPath(i: number): string {
  const s = [
    'handbook',
    'engineering',
    'product',
    'design',
    'operations',
    'security',
    'support',
    'marketing',
  ][i % 8]
  const sub = [
    'architecture',
    'runbooks',
    'guides',
    'reference',
    'policies',
    'onboarding',
    'postmortems',
    'decisions',
  ][Math.floor(i / 8) % 8]
  const bucket = `g${Math.floor(i / 64) % 64}`
  return `workspace/${s}/${sub}/${bucket}/doc-${i}.md`
}

function body(i: number, rev: number): string {
  const parts = [
    '---',
    `id: doc_${i}`,
    `title: Document ${i}`,
    '---',
    '',
    `# Document ${i}`,
    '',
    `Revision marker: ${rev}`,
    '',
  ]
  let size = parts.join('\n').length
  let p = 0
  while (size < 2048) {
    const para = `${LOREM}(paragraph ${p} of document ${i}, revision ${rev})`
    parts.push(para, '')
    size += para.length + 2
    p++
  }
  return parts.join('\n')
}

function pct(s: number[], p: number): number {
  const a = [...s].sort((x, y) => x - y)
  return +(a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)] as number).toFixed(3)
}

console.log(`node ${process.version} on ${os.platform()} ${os.arch()}`)
console.log(`nodegit ${require('nodegit/package.json').version} loaded: OK`)

// --- 1. API surface that matters for ADR-014
const surface = {
  'Odb.open (read objects)': typeof Git.Odb?.open,
  'Odb.addDiskAlternate': typeof Git.Odb?.prototype?.addDiskAlternate,
  'OdbBackend (custom object backend)': typeof Git.OdbBackend,
  Refdb: typeof Git.Refdb,
  'RefdbBackend (custom ref backend)': typeof Git.RefdbBackend,
  'Treebuilder (build trees with no index)': typeof Git.Treebuilder,
  'Reference.create': typeof Git.Reference?.create,
  'Reference.createMatching (CAS)': typeof Git.Reference?.createMatching,
  'Repository.createCommit': typeof Git.Repository?.prototype?.createCommit,
  'Merge.file (three-way merge)': typeof Git.Merge?.file,
}
console.log('\nAPI surface:')
for (const [k, v] of Object.entries(surface)) {
  console.log(
    `  ${v === 'undefined' ? 'MISSING ' : 'present '} ${k}${v === 'undefined' ? '' : ` (${v})`}`,
  )
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-nodegit-'))
const gitdir = path.join(root, 'ng.git')

// --- 2. bare repo, no working tree, no index
const repo = await Git.Repository.init(gitdir, 1)
console.log(`\nbare repository: ${repo.isBare() ? 'yes' : 'NO'}`)

const sig = (name: string, email: string) => Git.Signature.create(name, email, 1_757_000_000, 0)

// helper: build nested trees from a flat map, without an index
async function buildTree(files: Map<string, string>): Promise<string> {
  type Node = { dirs: Map<string, Node>; files: Map<string, string> }
  const rootNode: Node = { dirs: new Map(), files: new Map() }
  for (const [p, oid] of files) {
    const parts = p.split('/')
    let node = rootNode
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i] as string
      let next = node.dirs.get(seg)
      if (!next) {
        next = { dirs: new Map(), files: new Map() }
        node.dirs.set(seg, next)
      }
      node = next
    }
    node.files.set(parts[parts.length - 1] as string, oid)
  }
  const emit = async (node: Node): Promise<string> => {
    const b = await Git.Treebuilder.create(repo, null)
    for (const [name, oid] of node.files) await b.insert(name, Git.Oid.fromString(oid), 0o100644)
    for (const [name, child] of node.dirs) {
      await b.insert(name, Git.Oid.fromString(await emit(child)), 0o040000)
    }
    return (await b.write()).tostrS()
  }
  return await emit(rootNode)
}

const t0 = performance.now()
const files = new Map<string, string>()
for (let i = 0; i < DOCS; i++) {
  const oid = await repo.createBlobFromBuffer(Buffer.from(body(i, 0), 'utf8'))
  files.set(docPath(i), oid.tostrS())
}
const treeOid = await buildTree(files)
const c0 = await repo.createCommit(
  'refs/heads/main',
  sig('Importer', 'import@example.com'),
  sig('Quill', 'quill@quill.invalid'),
  `Import ${DOCS} documents\n\nQuill-Change-Note: bulk import\n`,
  Git.Oid.fromString(treeOid),
  [],
)
console.log(`import ${DOCS} docs, one commit, no index: ${(performance.now() - t0).toFixed(0)} ms`)

// --- 3. publish path: replace one blob, rewrite the trees, advance the ref
async function setPath(rootTree: string, p: string, blobOid: string): Promise<string> {
  const parts = p.split('/')
  const recurse = async (treeOid: string | null, depth: number): Promise<string> => {
    const existing = treeOid ? await Git.Tree.lookup(repo, Git.Oid.fromString(treeOid)) : null
    const b = await Git.Treebuilder.create(repo, existing)
    const name = parts[depth] as string
    if (depth === parts.length - 1) {
      await b.insert(name, Git.Oid.fromString(blobOid), 0o100644)
    } else {
      let child: string | null = null
      try {
        const e = existing ? existing.entryByName(name) : null
        child = e ? e.oid().tostrS() : null
      } catch {
        child = null
      }
      await b.insert(name, Git.Oid.fromString(await recurse(child, depth + 1)), 0o040000)
    }
    return (await b.write()).tostrS()
  }
  return await recurse(rootTree, 0)
}

const samples: number[] = []
let head = c0.tostrS()
for (let k = 0; k < N; k++) {
  const i = (k * 7919) % DOCS
  const t = performance.now()
  const blob = (await repo.createBlobFromBuffer(Buffer.from(body(i, 100 + k), 'utf8'))).tostrS()
  const parentCommit = await repo.getCommit(head)
  const newTree = await setPath((await parentCommit.getTree()).id().tostrS(), docPath(i), blob)
  const oid = await repo.createCommit(
    'refs/heads/main',
    sig(`User ${i % 37}`, `user${i % 37}@example.com`),
    sig('Quill', 'quill@quill.invalid'),
    `Update Document ${i}\n\nQuill-Document-Id: doc_${i}\nQuill-Change-Note: revision ${k}\n`,
    Git.Oid.fromString(newTree),
    [parentCommit],
  )
  samples.push(performance.now() - t)
  head = oid.tostrS()
}
console.log(
  `publish at ${DOCS} docs: p50=${pct(samples, 50)}ms p95=${pct(samples, 95)}ms p99=${pct(samples, 99)}ms (n=${N})`,
)

// --- 4. compare-and-swap on the ref
let casAvailable = false
try {
  const current = await Git.Reference.lookup(repo, 'refs/heads/main')
  // createMatching(repo, name, id, force, currentValue, logMessage) is
  // libgit2's git_reference_create_matching == compare-and-swap.
  await Git.Reference.createMatching(
    repo,
    'refs/heads/main',
    current.target(),
    1,
    current.target(),
    'no-op CAS',
  )
  casAvailable = true
  let rejected = false
  try {
    await Git.Reference.createMatching(
      repo,
      'refs/heads/main',
      current.target(),
      1,
      Git.Oid.fromString('0'.repeat(39) + '1'),
      'stale CAS',
    )
  } catch {
    rejected = true
  }
  console.log(`Reference.createMatching CAS: available, stale value rejected: ${rejected}`)
} catch (e) {
  console.log(`Reference.createMatching CAS: NOT usable (${(e as Error).message})`)
}

// --- 5. history for one path
const t1 = performance.now()
const walker = repo.createRevWalk()
walker.push(Git.Oid.fromString(head))
const hist = await walker.fileHistoryWalk(docPath(7), 5000)
console.log(
  `fileHistoryWalk for one path over ${N + 1} commits: ${(performance.now() - t1).toFixed(1)} ms, ${hist.length} revisions`,
)

// --- 6. three-way merge via libgit2
const mergeAvailable = typeof Git.Merge?.file === 'function'
console.log(
  `Merge.file (libgit2 three-way merge of blobs): ${mergeAvailable ? 'present' : 'MISSING'}`,
)

console.log(`\ncustom ODB backend reachable from JS: ${typeof Git.OdbBackend !== 'undefined'}`)
console.log(`custom refdb backend reachable from JS: ${typeof Git.RefdbBackend !== 'undefined'}`)
console.log(`casAvailable=${casAvailable}`)
console.log(`repo: ${gitdir}`)
