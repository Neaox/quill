/**
 * Edge cases that decide encoding rules in ADR-014/ADR-015.
 *
 *   node test-edge.ts
 *
 * 1. Change notes are free text. Trailers are single-line. What happens?
 * 2. Titles, author names and paths are Unicode. Does git still agree with us?
 * 3. Does our tree ordering match git's for awkward names?
 */

import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ContentStore, type ContentChange } from './src/content-store.ts'
import { FsObjectStore } from './src/fs-store.ts'
import { readTrailers } from './src/git-core.ts'

let passed = 0
let failed = 0
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name} ${detail}`)
  }
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r4-edge-'))
const gitdir = path.join(root, 'edge.git')
const store = await FsObjectStore.init(gitdir)
const cs = new ContentStore(store)
const git = (args: string[]): string =>
  execFileSync('git', ['--git-dir', gitdir, ...args], { encoding: 'utf8' })

const pub = async (c: Partial<ContentChange> & { path: string }, head: string | null) => {
  const full: ContentChange = {
    documentId: c.documentId ?? 'doc_1',
    path: c.path,
    content: c.content ?? '# hello\n',
    title: c.title ?? 'Hello',
    changeNote: c.changeNote,
    author: c.author ?? { name: 'Ada Lovelace', email: 'ada@example.com' },
  }
  return await cs.publish(full, head)
}

console.log('\n[1] multi-line change notes')
let head: string | null = null
const multi = 'First line of the note.\nSecond line.\n\nFourth line.'
let r = await pub({ path: 'a.md', changeNote: multi, documentId: 'doc_a' }, head)
head = r.revision
const parsed = readTrailers((await gitMessage(r.revision)) ?? '')
check('our writer folded the note onto one line', !JSON.stringify(parsed).includes('\\n'))
const gitTrailer = git([
  'log',
  '-1',
  r.revision,
  '--format=%(trailers:key=Quill-Change-Note,valueonly)',
]).trim()
check('git reads back the folded note', gitTrailer === multi.replace(/\r?\n/g, ' '), gitTrailer)
console.log(`     stored as: ${JSON.stringify(gitTrailer)}`)

// what git itself supports: folded continuation lines
const foldedMessage = `Update Hello

Quill-Document-Id: doc_a
Quill-Change-Note: First line of the note.
  Second line.
  Fourth line.
`
const foldedOid = await writeRawCommit(foldedMessage)
const gitFolded = git([
  'log',
  '-1',
  foldedOid,
  '--format=%(trailers:key=Quill-Change-Note,valueonly,unfold)',
]).trim()
check(
  'git DOES support folded (indented) continuation lines',
  gitFolded.includes('Second line.') && gitFolded.includes('Fourth line.'),
  JSON.stringify(gitFolded),
)
const foldedParse = readTrailers(foldedMessage)
console.log(`     our readTrailers on a folded message: ${JSON.stringify(foldedParse)}`)
check(
  'our readTrailers loses the WHOLE trailer block when a value is folded',
  Object.keys(foldedParse).length === 0,
  JSON.stringify(foldedParse),
)

console.log('\n[2] Unicode in titles, authors, notes and paths')
r = await pub(
  {
    path: 'ドキュメント/Größe & cost — draft (v2).md',
    title: 'Größe — ドキュメント 📄',
    changeNote: 'Заметка об изменении — 変更メモ 🎉',
    documentId: 'doc_u',
    author: { name: 'Zoë Müller', email: 'zoe@example.com' },
    content: '# Größe\n\n日本語のテキスト。\n',
  },
  head,
)
head = r.revision
check(
  'git fsck clean with Unicode paths',
  git(['fsck', '--strict', '--no-dangling', '--no-progress']).trim() === '',
)
const subject = git(['log', '-1', r.revision, '--format=%s']).trim()
check('git round-trips the Unicode subject', subject === 'Update Größe — ドキュメント 📄', subject)
const an = git(['log', '-1', r.revision, '--format=%an']).trim()
check('git round-trips the Unicode author name', an === 'Zoë Müller', an)
const note = git([
  'log',
  '-1',
  r.revision,
  '--format=%(trailers:key=Quill-Change-Note,valueonly)',
]).trim()
check(
  'git round-trips the Unicode change note',
  note === 'Заметка об изменении — 変更メモ 🎉',
  note,
)
const ls = git(['ls-tree', '-r', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean)
check(
  'git lists the Unicode path unmangled',
  ls.includes('ドキュメント/Größe & cost — draft (v2).md'),
  JSON.stringify(ls),
)
check(
  'we read the Unicode path back',
  (await cs.read('ドキュメント/Größe & cost — draft (v2).md')) !== null,
)

console.log('\n[3] tree ordering for awkward names')
// `a.md` vs directory `a` vs `a-b.md`: git sorts a directory as if it ended in `/`.
for (const p of ['z/a.md', 'z-x.md', 'z.md', 'z/b/c.md', 'zz.md', 'z!.md', 'z~.md']) {
  const res = await pub({ path: p, documentId: `doc_${p}` }, head)
  head = res.revision
}
check(
  'git fsck --strict accepts our tree ordering',
  git(['fsck', '--strict', '--no-dangling', '--no-progress']).trim() === '',
  git(['fsck', '--strict', '--no-dangling', '--no-progress']).trim(),
)
// git re-writes the tree itself; if our order were wrong the oid would differ.
const ourRoot = git(['rev-parse', 'HEAD^{tree}']).trim()
const viaIndex = (() => {
  const idx = path.join(root, 'tmp-index')
  execFileSync('git', ['--git-dir', gitdir, 'read-tree', ourRoot], {
    env: { ...process.env, GIT_INDEX_FILE: idx },
    encoding: 'utf8',
  })
  return execFileSync('git', ['--git-dir', gitdir, 'write-tree'], {
    env: { ...process.env, GIT_INDEX_FILE: idx },
    encoding: 'utf8',
  }).trim()
})()
check(
  'git rebuilds the identical tree oid from our tree',
  viaIndex === ourRoot,
  `${viaIndex} vs ${ourRoot}`,
)

console.log('\n[4] empty document, and a document that is only front matter')
r = await pub({ path: 'empty.md', content: '', documentId: 'doc_e' }, head)
head = r.revision
check('empty blob stored', (await cs.read('empty.md')) === '')
check('git agrees the blob is empty', git(['show', `${r.revision}:empty.md`]) === '')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
else await fs.rm(root, { recursive: true, force: true })

async function gitMessage(oid: string): Promise<string | null> {
  return git(['log', '-1', oid, '--format=%B'])
}

async function writeRawCommit(message: string): Promise<string> {
  const tree = git(['rev-parse', 'HEAD^{tree}']).trim()
  return execFileSync('git', ['--git-dir', gitdir, 'commit-tree', tree, '-m', message], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Ada',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Quill',
      GIT_COMMITTER_EMAIL: 'quill@quill.invalid',
    },
  }).trim()
}
