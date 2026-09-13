/**
 * The real git CLI is the arbiter of correctness for everything this package
 * encodes (ADR-014). If `git fsck --strict` ever disagrees with a tree the
 * store wrote, the design is wrong, not the test.
 *
 * Every case builds its own repository, so one failure cannot cascade into the
 * next and the cases can be read, and run, in any order.
 *
 * The suite skips itself, with a reason, when git is not on PATH. It is on
 * PATH in CI, where this is a required check on every supported platform.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceId } from '@quill/domain'
import { afterAll, describe, expect, it } from 'vitest'

import { CHANGE_NOTE_TRAILER, DOCUMENT_ID_TRAILER, PRODUCT_NAME } from './branding.ts'
import { FilesystemObjectStore } from './filesystem/filesystem-object-store.ts'
import { GitContentStore } from './git-content-store.ts'
import type { ObjectStoreProvider } from './object-store.ts'
import {
  AUTHOR,
  JITTER,
  markdown,
  newDocument,
  newWorkspaceId,
  NOW,
  write,
} from './test-fixtures.ts'
import { OURS_LABEL, THEIRS_LABEL, threeWayMerge } from './three-way-merge.ts'

function gitVersion(): string | null {
  try {
    return execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const VERSION = gitVersion()
const root = await mkdtemp(join(tmpdir(), 'content-store-git-'))
const opened: FilesystemObjectStore[] = []
let repositories = 0

const ONBOARDING = newDocument()
const UNICODE = newDocument()
const CHANGE_NOTE = 'Rewrote the introduction.\nAlso fixed a typo.'
const UNICODE_PATH = 'ドキュメント/Größe & cost — draft (v2).md'

afterAll(async () => {
  await Promise.all(opened.map((store) => store.close()))
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

interface Repository {
  readonly gitdir: string
  readonly store: GitContentStore
  readonly objects: FilesystemObjectStore
  readonly workspace: WorkspaceId
  git(...args: string[]): string
}

async function repository(): Promise<Repository> {
  repositories += 1
  const gitdir = join(root, `workspace-${repositories}.git`)
  const objects = await FilesystemObjectStore.create(gitdir, { now: NOW })
  opened.push(objects)
  const provider: ObjectStoreProvider = { forWorkspace: async () => objects }
  return {
    gitdir,
    objects,
    store: new GitContentStore({ provider, now: NOW, random: JITTER }),
    workspace: newWorkspaceId(),
    git: (...args) =>
      execFileSync('git', ['--git-dir', gitdir, ...args], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      }),
  }
}

/** Two revisions: one document, then a second in a Unicode path. */
async function seeded(): Promise<Repository> {
  const repo = await repository()
  const first = await repo.store.publish({
    workspaceId: repo.workspace,
    changes: [
      write(ONBOARDING, 'handbook/onboarding.md', markdown(ONBOARDING, 'Onboarding', 'Welcome.')),
    ],
    author: AUTHOR,
    base: null,
    changeNote: CHANGE_NOTE,
  })
  if (first.kind !== 'published') throw new Error('expected a revision')
  const second = await repo.store.publish({
    workspaceId: repo.workspace,
    changes: [
      write(UNICODE, UNICODE_PATH, markdown(UNICODE, 'Größe — ドキュメント 📄', '日本語。')),
      write(ONBOARDING, 'handbook/onboarding.md', markdown(ONBOARDING, 'Onboarding', 'Revised.')),
    ],
    author: { name: 'Zoë Müller', email: 'zoe@example.com' },
    base: first.revision,
  })
  if (second.kind !== 'published') throw new Error('expected a revision')
  return repo
}

/** `git merge-file` exits non-zero on a conflict, with the merge on stdout. */
function stdoutOf(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'stdout' in error &&
    typeof error.stdout === 'string'
  ) {
    return error.stdout
  }
  throw error
}

function gitMergeFile(directory: string): string {
  try {
    return execFileSync(
      'git',
      [
        'merge-file',
        '-L',
        OURS_LABEL,
        '-L',
        'base',
        '-L',
        THEIRS_LABEL,
        '-p',
        join(directory, 'ours'),
        join(directory, 'base'),
        join(directory, 'theirs'),
      ],
      { encoding: 'utf8' },
    )
  } catch (error) {
    return stdoutOf(error)
  }
}

it('runs against the git CLI, or says why it cannot', (context) => {
  if (VERSION === null) {
    context.skip('git is not on PATH, so the compatibility suite cannot run')
    return
  }
  expect(VERSION).toContain('git version')
})

describe.skipIf(VERSION === null)('a repository the git CLI can read', () => {
  it('passes git fsck --strict', async () => {
    const repo = await seeded()
    expect(repo.git('fsck', '--strict', '--no-dangling', '--no-progress').trim()).toBe('')
  })

  it('puts the revisions on the branch HEAD points at', async () => {
    const repo = await seeded()
    expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
    expect(repo.git('log', '--format=%H').trim().split('\n')).toHaveLength(2)
  })

  it('reads the subject, the author, and the committer git log expects', async () => {
    const repo = await seeded()
    const [subject, author, committer] = repo
      .git('log', '-1', 'HEAD~1', '--format=%s%n%an <%ae>%n%cn')
      .split('\n')
    expect(subject).toBe('Update Onboarding')
    expect(author).toBe(`${AUTHOR.name} <${AUTHOR.email}>`)
    expect(committer).toBe(PRODUCT_NAME)
  })

  it('reads the trailers a revisions-index rebuild depends on', async () => {
    const repo = await seeded()
    const documentIds = repo
      .git('log', '-1', 'HEAD~1', `--format=%(trailers:key=${DOCUMENT_ID_TRAILER},valueonly)`)
      .trim()
    const note = repo
      .git('log', '-1', 'HEAD~1', `--format=%(trailers:key=${CHANGE_NOTE_TRAILER},valueonly)`)
      .trim()
    expect(documentIds).toBe(ONBOARDING)
    expect(note).toBe('Rewrote the introduction. Also fixed a typo.')
  })

  it('shows the document content byte for byte', async () => {
    const repo = await seeded()
    const source = await repo.store.read(repo.workspace, ONBOARDING)
    expect(repo.git('show', 'HEAD:handbook/onboarding.md')).toBe(source?.markdown)
  })

  it('lists Unicode paths unmangled', async () => {
    const repo = await seeded()
    const paths = repo.git('ls-tree', '-r', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean)
    expect(paths).toContain(UNICODE_PATH)
  })

  it('rebuilds the identical tree object from our tree ordering', async () => {
    const repo = await seeded()
    expect(rebuildTree(repo)).toBe(repo.git('rev-parse', 'HEAD^{tree}').trim())
  })

  it('orders names that are prefixes of a directory exactly as git does', async () => {
    const repo = await repository()
    // git sorts a subtree as if its name ended in `/`, so `z/` falls between
    // `z-x.md` and `z.md`. Getting this wrong writes a tree git fsck rejects.
    const paths = ['z-x.md', 'z/inner.md', 'z.md', 'zz.md', 'z/a/deep.md']
    const result = await repo.store.publish({
      workspaceId: repo.workspace,
      changes: paths.map((path) => {
        const id = newDocument()
        return write(id, path, markdown(id, path))
      }),
      author: AUTHOR,
      base: null,
    })
    expect(result.kind).toBe('published')
    expect(repo.git('fsck', '--strict', '--no-dangling', '--no-progress').trim()).toBe('')
    expect(rebuildTree(repo)).toBe(repo.git('rev-parse', 'HEAD^{tree}').trim())
    // `-` (0x2d) then `.` (0x2e) then `/` (0x2f) then `z` (0x7a).
    expect(repo.git('ls-tree', '--name-only', 'HEAD').trim().split('\n')).toEqual([
      'z-x.md',
      'z.md',
      'z',
      'zz.md',
    ])
  })

  it('keeps a reflog git can read', async () => {
    const repo = await seeded()
    expect(repo.git('reflog', 'show', 'main').trim().split('\n')).toHaveLength(2)
  })

  it('stays readable after git gc has packed it away', async () => {
    const repo = await seeded()
    repo.git('gc', '--quiet', '--prune=now')
    expect(repo.git('count-objects', '-v')).toContain('count: 0')
    const source = await repo.store.read(repo.workspace, ONBOARDING)
    expect(source?.markdown).toContain('Revised.')
    expect(await repo.store.history(repo.workspace, ONBOARDING, { limit: 10 })).toHaveLength(2)
  })

  it('finds refs that git gc moved into packed-refs', async () => {
    const repo = await seeded()
    repo.git('gc', '--quiet', '--prune=now')
    expect(await repo.objects.readRef('refs/heads/main')).toBe(repo.git('rev-parse', 'HEAD').trim())
  })

  it('merges exactly the bytes `git merge-file` does', async () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      [
        'one\ntwo\nthree\nfour\nfive\n',
        'ONE\ntwo\nthree\nfour\nfive\n',
        'one\ntwo\nthree\nfour\nFIVE\n',
      ],
      ['one\ntwo\nthree\n', 'one\nOURS\nthree\n', 'one\nTHEIRS\nthree\n'],
      ['', 'ours only\n', 'theirs only\n'],
      ['a\nb\nc\n', 'a\nc\n', 'a\nb\nB\nc\n'],
    ]
    for (const [index, [base, ours, theirs]] of cases.entries()) {
      const directory = join(root, `merge-${index}`)
      await mkdir(directory, { recursive: true })
      await Promise.all(
        Object.entries({ base, ours, theirs }).map(([name, content]) =>
          writeFile(join(directory, name), content),
        ),
      )
      expect(threeWayMerge(base, ours, theirs).text).toBe(gitMergeFile(directory))
    }
  })
})

/** `git read-tree` then `git write-tree`: git's own opinion of our ordering. */
function rebuildTree(repo: Repository): string {
  const index = join(root, `scratch-index-${repositories}`)
  const env = { ...process.env, GIT_INDEX_FILE: index }
  execFileSync('git', ['--git-dir', repo.gitdir, 'read-tree', 'HEAD^{tree}'], {
    env,
    encoding: 'utf8',
  })
  return execFileSync('git', ['--git-dir', repo.gitdir, 'write-tree'], {
    env,
    encoding: 'utf8',
  }).trim()
}
