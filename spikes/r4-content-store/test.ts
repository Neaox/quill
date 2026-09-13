/**
 * Correctness checks for the hand-written object model, including the one
 * that matters most: the real git CLI must accept the repository.
 *
 *   node test.ts
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  ContentStore,
  mergeMarkdown,
  renderUnifiedish,
  StaleBaseError,
  type ContentChange,
} from './src/content-store.ts'
import { makeDoc } from './src/corpus.ts'
import { FsObjectStore } from './src/fs-store.ts'
import { buildTreeFromPaths, writeBlob, writeCommit } from './src/git-core.ts'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name} ${detail}`)
  }
}

function git(gitdir: string, args: string[]): string {
  return execFileSync('git', ['--git-dir', gitdir, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

const change = (i: number, rev: number, note?: string): ContentChange => {
  const d = makeDoc(i, rev)
  return {
    documentId: d.id,
    path: d.path,
    content: d.content,
    title: d.title,
    changeNote: note,
    author: { name: `User ${i % 5}`, email: `user${i % 5}@example.com` },
  }
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-test-'))
  const gitdir = path.join(root, 'content.git')
  const store = await FsObjectStore.init(gitdir)
  const cs = new ContentStore(store)

  console.log('\n[1] publish / read / listTree')
  const N = 40
  let head: string | null = null
  for (let i = 0; i < N; i++) {
    const r = await cs.publish(change(i, 0), head)
    head = r.revision
    check(`publish ${i} single CAS attempt`, r.attempts === 1)
  }
  const readBack = await cs.read(makeDoc(7, 0).path)
  check('read returns published content', readBack === makeDoc(7, 0).content)
  const tree = await cs.listTree()
  check(`listTree has ${N} entries`, tree.length === N, `got ${tree.length}`)

  console.log('\n[2] history')
  const rev1 = await cs.publish(change(7, 1, 'Second pass'), head)
  head = rev1.revision
  const rev2 = await cs.publish(change(7, 2, 'Third pass'), head)
  head = rev2.revision
  const h = await cs.history(makeDoc(7, 0).path, { limit: 10 })
  check('history by path finds 3 revisions', h.length === 3, `got ${h.length}`)
  check('history newest first', h[0]?.revision === rev2.revision)
  check('change-note trailer parsed', h[0]?.changeNote === 'Third pass', JSON.stringify(h[0]))
  check('document-id trailer parsed', h[0]?.documentId === 'doc_000007')
  check('author preserved', h[0]?.author.email === 'user2@example.com', h[0]?.author.email)
  const hid = await cs.historyByDocumentId('doc_000007', { limit: 10 })
  check('history by document id agrees', hid.length === 3, `got ${hid.length}`)

  console.log('\n[3] diff')
  const d = await cs.diff(rev1.revision, rev2.revision, makeDoc(7, 0).path)
  check('diff finds changed lines', d.added > 0 && d.removed > 0, JSON.stringify(d.hunks.length))
  const rendered = renderUnifiedish(d)
  check('diff mentions revision marker', rendered.includes('Revision marker: 2'))

  console.log('\n[4] move and delete')
  const moved: ContentChange = { ...change(3, 1), path: 'workspace/moved/doc-3.md' }
  moved.previousPath = makeDoc(3, 0).path
  const mv = await cs.publish(moved, head)
  head = mv.revision
  check('moved path readable', (await cs.read('workspace/moved/doc-3.md')) !== null)
  check('old path gone', (await cs.read(makeDoc(3, 0).path)) === null)
  const del: ContentChange = { ...change(4, 1), content: null }
  const dl = await cs.publish(del, head)
  head = dl.revision
  check('deleted path gone', (await cs.read(makeDoc(4, 0).path)) === null)
  check(
    'deleted content still in history',
    (await cs.read(makeDoc(4, 0).path, mv.revision)) !== null,
  )

  console.log('\n[5] stale base detection')
  const stale = head
  const a = await cs.publish(change(9, 1), stale)
  head = a.revision
  let threw = false
  try {
    await cs.publish(change(9, 2), stale)
  } catch (e) {
    threw = e instanceof StaleBaseError
  }
  check('stale base on same document rejected', threw)
  const other = await cs.publish(change(11, 1), stale) // different document, stale base
  head = other.revision
  check('stale base on a different document allowed', other.attempts === 1)

  console.log('\n[6] compare-and-swap under concurrency')
  let retries = 0
  const cs2 = new ContentStore(store, { onRetry: () => retries++ })
  const before = head
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, k) => cs2.publish(change(100 + k, 0), null)),
  )
  const revs = new Set(results.map((r) => r.revision))
  check('8 concurrent publishes produced 8 distinct commits', revs.size === 8)
  check('at least one CAS retry happened', retries > 0, `retries=${retries}`)
  head = await cs.head()
  check('ref moved', head !== before)
  const chainLen = git(gitdir, ['rev-list', '--count', 'HEAD']).trim()
  check('all 8 commits are on the chain', Number(chainLen) >= 8 + N + 6, `count=${chainLen}`)
  const all = await cs2.listTree()
  check('all concurrent documents present', all.length === N - 1 + 8, `got ${all.length}`)

  console.log('\n[7] the real git CLI must accept this repository')
  // --no-dangling: losing CAS attempts leave unreferenced commits behind, exactly
  // as the git CLI itself does. They are garbage, not corruption; gc prunes them.
  const fsck = git(gitdir, ['fsck', '--strict', '--no-dangling', '--no-progress'])
  check('git fsck --strict clean', fsck.trim() === '', fsck.trim().slice(0, 400))
  const log = git(gitdir, ['log', '--format=%H %an <%ae> | %s', '-5'])
  check('git log works', log.split('\n').filter(Boolean).length === 5)
  check('git log shows our author', log.includes('@example.com'), log.slice(0, 200))
  const committer = git(gitdir, ['log', '-1', '--format=%cn <%ce>']).trim()
  check('committer is Quill', committer === 'Quill <quill@quill.invalid>', committer)
  const trailers = git(gitdir, ['log', '-1', rev2.revision, '--format=%(trailers:only)']).trim()
  check('git parses our trailers', trailers.includes('Quill-Document-Id: doc_000007'), trailers)
  const show = git(gitdir, ['show', `${rev2.revision}:${makeDoc(7, 0).path}`])
  check('git show prints the blob', show.includes('Revision marker: 2'))
  const cliLog = git(gitdir, ['log', '--format=%H', '--', makeDoc(7, 0).path])
    .trim()
    .split('\n')
  check('git log -- <path> agrees with our history', cliLog.length === 3, `cli=${cliLog.length}`)
  const cliDiff = git(gitdir, ['diff', '--stat', rev1.revision, rev2.revision])
  check('git diff between our commits works', cliDiff.includes('doc-7.md'), cliDiff)
  const cat = git(gitdir, ['cat-file', '-t', rev2.revision]).trim()
  check('git cat-file says commit', cat === 'commit')

  console.log('\n[8] clone-ability (users may clone)')
  const clone = path.join(root, 'clone')
  execFileSync('git', ['clone', '--quiet', gitdir, clone], { encoding: 'utf8' })
  const cloned = await fs.readFile(path.join(clone, makeDoc(7, 0).path), 'utf8')
  check('clone produces a working tree with our content', cloned.includes('Revision marker: 2'))

  console.log('\n[9] packfile reader survives git gc')
  git(gitdir, ['gc', '--aggressive', '--prune=now'])
  const store2 = new FsObjectStore(gitdir)
  const cs3 = new ContentStore(store2)
  const afterGc = await cs3.read(makeDoc(7, 0).path)
  check('read after git gc (packfile path)', afterGc === makeDoc(7, 2).content)
  const histAfterGc = await cs3.history(makeDoc(7, 0).path, { limit: 10 })
  check('history after git gc', histAfterGc.length === 3, `got ${histAfterGc.length}`)
  const pubAfterGc = await cs3.publish(change(7, 3), await cs3.head())
  check('publish after git gc', typeof pubAfterGc.revision === 'string')
  check(
    'git fsck still clean after we wrote onto a packed repo',
    git(gitdir, ['fsck', '--strict', '--no-dangling', '--no-progress']).trim() === '',
  )

  console.log('\n[10] bulk import is one commit (ADR-015)')
  const bulkdir = path.join(root, 'bulk.git')
  const bulkStore = await FsObjectStore.init(bulkdir)
  const files = new Map<string, string>()
  for (let i = 0; i < 500; i++) {
    const doc = makeDoc(i, 0)
    files.set(doc.path, await writeBlob(bulkStore, Buffer.from(doc.content, 'utf8')))
  }
  const bulkTree = await buildTreeFromPaths(bulkStore, files)
  const when = 1_757_000_000
  const bulkCommit = await writeCommit(bulkStore, {
    tree: bulkTree,
    parents: [],
    author: { name: 'Importer', email: 'import@example.com', when, tz: '+0000' },
    committer: { name: 'Quill', email: 'quill@quill.invalid', when, tz: '+0000' },
    message: 'Import 500 documents\n\nQuill-Change-Note: bulk import\n',
  })
  await bulkStore.casRef('refs/heads/main', null, bulkCommit)
  check(
    'bulk fsck clean',
    git(bulkdir, ['fsck', '--strict', '--no-dangling', '--no-progress']).trim() === '',
  )
  const lsFiles = git(bulkdir, ['ls-tree', '-r', '--name-only', 'HEAD']).trim().split('\n')
  check('bulk import produced 500 files in 1 commit', lsFiles.length === 500, `${lsFiles.length}`)
  check('bulk commit count is 1', git(bulkdir, ['rev-list', '--count', 'HEAD']).trim() === '1')

  console.log('\n[11] three-way Markdown merge')
  const base = [
    '# Title',
    '',
    'Intro paragraph.',
    '',
    '## Setup',
    '',
    'Run the installer.',
    '',
    '## Notes',
    '',
    'Nothing yet.',
  ].join('\n')
  const ours = base.replace('Intro paragraph.', 'Intro paragraph, rewritten by Ada.')
  const theirs = base.replace('Nothing yet.', 'See the runbook for details.')
  const clean = mergeMarkdown(base, ours, theirs)
  check('non-overlapping edits merge cleanly', clean.ok && clean.conflicts === 0)
  check('merge kept our edit', clean.text.includes('rewritten by Ada'))
  check('merge kept their edit', clean.text.includes('See the runbook'))

  const oursC = base.replace('Run the installer.', 'Run `quill setup`.')
  const theirsC = base.replace('Run the installer.', 'Run the bootstrap script.')
  const conflicted = mergeMarkdown(base, oursC, theirsC)
  check('overlapping edits conflict', !conflicted.ok && conflicted.conflicts === 1)
  check(
    'conflict markers present',
    conflicted.text.includes('<<<<<<< yours') &&
      conflicted.text.includes('||||||| base') &&
      conflicted.text.includes('>>>>>>> published'),
  )

  // cross-check against the git CLI's own merge-file
  const mdir = path.join(root, 'merge')
  await fs.mkdir(mdir, { recursive: true })
  await fs.writeFile(path.join(mdir, 'base.md'), base)
  await fs.writeFile(path.join(mdir, 'ours.md'), ours)
  await fs.writeFile(path.join(mdir, 'theirs.md'), theirs)
  let cliMergeOk = true
  try {
    execFileSync('git', ['merge-file', '-p', 'ours.md', 'base.md', 'theirs.md'], {
      cwd: mdir,
      encoding: 'utf8',
    })
  } catch {
    cliMergeOk = false
  }
  check('git merge-file agrees the clean case is clean', cliMergeOk)
  await fs.writeFile(path.join(mdir, 'ours.md'), oursC)
  await fs.writeFile(path.join(mdir, 'theirs.md'), theirsC)
  let cliConflict = false
  try {
    execFileSync('git', ['merge-file', '-p', 'ours.md', 'base.md', 'theirs.md'], {
      cwd: mdir,
      encoding: 'utf8',
    })
  } catch {
    cliConflict = true
  }
  check('git merge-file agrees the conflicting case conflicts', cliConflict)

  console.log(`\n${passed} passed, ${failed} failed`)
  console.log(`repo: ${gitdir}`)
  if (failed > 0) process.exitCode = 1
  else await fs.rm(root, { recursive: true, force: true })
}

await main()
