import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { ExternalSourceError } from '@quill/application'
import type { SourceChange, SourceFileContent } from '@quill/application'
import { afterAll, describe, expect, it } from 'vitest'

import { blobId, WorkingTreeSource } from './working-tree-source.ts'
import type { WorkingTreeSourceOptions } from './working-tree-source.ts'

const root = await mkdtemp(join(tmpdir(), 'quill-working-tree-'))
afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }))

let trees = 0
const NOW = new Date('2026-11-11T00:00:00Z')

function git(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Ada Author',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Ada Author',
      GIT_COMMITTER_EMAIL: 'ada@example.com',
    },
  }).trim()
}

/** A directory holding these files; a repository with them committed when `repository` is set. */
async function tree(
  files: Readonly<Record<string, string | Uint8Array>>,
  options: { readonly repository?: boolean } = {},
): Promise<string> {
  trees += 1
  const directory = join(root, `tree-${trees}`)
  await mkdir(directory, { recursive: true })
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true })
    await writeFile(join(directory, path), content)
  }
  if (options.repository === true) {
    git(directory, ['init', '--quiet', '--initial-branch=main'])
    git(directory, ['config', 'core.autocrlf', 'false'])
    git(directory, ['add', '--all'])
    git(directory, ['commit', '--quiet', '--no-verify', '-m', 'Files'])
  }
  return directory
}

function open(directory: string, options: Partial<WorkingTreeSourceOptions> = {}) {
  return WorkingTreeSource.open({ root: directory, paths: ['docs'], now: () => NOW, ...options })
}

async function all<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = []
  for await (const item of items) collected.push(item)
  return collected
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ExternalSourceError) return error.reason
    throw error
  }
  throw new Error('it did not fail')
}

describe('a working tree as a source', () => {
  it('names each file by its Git blob id, line endings and all', async () => {
    const lf = '# Guide\n\nText.\n'
    const crlf = '# Guide\r\n\r\nText.\r\n'
    const directory = await tree({ 'docs/lf.md': lf, 'docs/crlf.md': crlf }, { repository: true })
    const source = await open(directory)
    const head = await source.fetch()
    const files = await all(source.files(head))
    expect(files).toEqual([
      {
        path: 'docs/crlf.md',
        fileId: git(directory, ['hash-object', 'docs/crlf.md']),
        kind: 'file',
      },
      { path: 'docs/lf.md', fileId: git(directory, ['hash-object', 'docs/lf.md']), kind: 'file' },
    ])
    expect(files[0]?.fileId).toBe(blobId(Buffer.from(crlf)))
    const read = await all(source.readFiles(files.map(({ fileId }) => fileId)))
    expect(
      read.map((content) => content.kind === 'content' && Buffer.from(content.bytes).toString()),
    ).toEqual([crlf, lf])
    await source.close()
  })

  it('is one revision, named by what it holds', async () => {
    const directory = await tree({ 'docs/a.md': '# A\n' }, { repository: true })
    const source = await open(directory)
    const head = await source.head()
    expect(await source.fetch()).toBe(head)
    const [revision] = await all(source.history(null, head))
    expect(revision).toMatchObject({ id: head, committedAt: NOW })
    expect(await all(source.history(head, head))).toEqual([])
    expect(await all(source.changes(null, head))).toEqual([
      { kind: 'added', file: expect.objectContaining({ path: 'docs/a.md' }) },
    ])
    await writeFile(join(directory, 'docs/a.md'), '# A, changed\n')
    const changed = await source.head()
    expect(changed).not.toBe(head)
    expect(await all(source.history(head, changed))).toHaveLength(1)
    expect(await failure(all(source.files('0'.repeat(40))))).toBe('unknown-revision')
    expect(await failure(all(source.history('elsewhere', changed)))).toBe('unknown-revision')
  })

  it('says what changed since an earlier look, under its paths', async () => {
    const directory = await tree(
      { 'docs/kept.md': '# Kept\n', 'docs/gone.md': '# Gone\n', 'docs/edited.md': '# One\n' },
      { repository: true },
    )
    const source = await open(directory)
    const before = await source.head()
    await unlink(join(directory, 'docs/gone.md'))
    await writeFile(join(directory, 'docs/edited.md'), '# Two\n')
    await writeFile(join(directory, 'docs/new.md'), '# New\n')
    const after = await source.head()
    const changes: SourceChange[] = await all(source.changes(before, after))
    expect(
      changes.map((change) => [change.kind, 'file' in change ? change.file.path : change.path]),
    ).toEqual([
      ['modified', 'docs/edited.md'],
      ['added', 'docs/new.md'],
      ['removed', 'docs/gone.md'],
    ])
    await source.narrow(['docs/kept.md'])
    expect(await all(source.changes(before, after))).toEqual([])
  })

  it('reads only under its paths, and widens and narrows with them', async () => {
    const directory = await tree(
      { 'docs/a.md': '# A\n', 'notes/b.md': '# B\n', 'README.md': '# Readme\n' },
      { repository: true },
    )
    const source = await open(directory)
    const head = await source.head()
    expect((await all(source.files(head))).map(({ path }) => path)).toEqual(['docs/a.md'])
    expect(await source.file(head, 'notes/b.md')).toBeNull()
    await source.narrow(['docs', 'notes'])
    expect((await all(source.files(head))).map(({ path }) => path)).toEqual([
      'docs/a.md',
      'notes/b.md',
    ])
    expect(await source.file(head, 'notes/b.md')).toMatchObject({ kind: 'file' })
    expect(await source.file(head, 'notes/missing.md')).toBeNull()
    expect(await failure(source.narrow(['../out']))).toBe('invalid-path')
    expect(await failure(open(directory, { paths: ['/abs'] }))).toBe('invalid-path')
  })

  it('lists what Git would commit: the index and untracked files it does not ignore', async () => {
    const directory = await tree(
      { 'docs/a.md': '# A\n', '.gitignore': 'docs/build/\n', 'docs/deleted.md': '# D\n' },
      { repository: true },
    )
    await writeFile(join(directory, 'docs/untracked.md'), '# U\n')
    await mkdir(join(directory, 'docs/build'), { recursive: true })
    await writeFile(join(directory, 'docs/build/out.md'), '# Built\n')
    await unlink(join(directory, 'docs/deleted.md'))
    // A tracked path that is a directory on disk now, and a submodule's commit.
    git(directory, [
      'update-index',
      '--add',
      '--cacheinfo',
      `100644,${'a'.repeat(40)},docs/now-a-folder`,
    ])
    await mkdir(join(directory, 'docs/now-a-folder'), { recursive: true })
    git(directory, ['update-index', '--add', '--cacheinfo', `160000,${'b'.repeat(40)},docs/module`])
    const source = await open(directory)
    const head = await source.head()
    expect((await all(source.files(head))).map(({ path }) => path)).toEqual([
      'docs/a.md',
      'docs/untracked.md',
    ])
  })

  it('reads a link the index records as one, though it was checked out as a plain file', async () => {
    const directory = await tree({ 'docs/a.md': '# A\n' }, { repository: true })
    const target = '../outside.md'
    const id = git(directory, ['hash-object', '-w', '--stdin'], target)
    git(directory, ['update-index', '--add', '--cacheinfo', `120000,${id},docs/link.md`])
    await writeFile(join(directory, 'docs/link.md'), target)
    const source = await open(directory)
    const head = await source.head()
    expect(await source.file(head, 'docs/link.md')).toEqual({
      path: 'docs/link.md',
      fileId: id,
      kind: 'symbolic-link',
    })
  })

  it('never follows a symbolic link or a junction', async () => {
    const directory = await tree({ 'docs/a.md': '# A\n', 'elsewhere/secret.md': '# Secret\n' })
    await symlink('../elsewhere/secret.md', join(directory, 'docs/link.md'))
    await symlink(join(directory, 'elsewhere'), join(directory, 'docs/junction'), 'junction')
    for (const executable of [null, 'git'] as const) {
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- one way of listing, then the other
      const source = await open(directory, { executable })
      const head = await source.head()
      const files = await all(source.files(head))
      expect(files.map(({ path, kind }) => [path, kind])).toEqual([
        ['docs/a.md', 'file'],
        ['docs/junction', 'symbolic-link'],
        ['docs/link.md', 'symbolic-link'],
      ])
      const link = files.find(({ path }) => path === 'docs/link.md')
      const [read] = await all(source.readFiles([link?.fileId ?? '']))
      expect(read).toMatchObject({ kind: 'content' })
      expect(read?.kind === 'content' && Buffer.from(read.bytes).toString()).toBe(
        '../elsewhere/secret.md',
      )
    }
  })

  it('answers which paths are there from names, exactly as they are spelt', async () => {
    const files = { 'docs/setup.md': '# Setup\n', 'src/run.ts': 'run()\n' }
    for (const repository of [true, false]) {
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- with Git, then without
      const directory = await tree(
        // Without Git, a `.git` at the top is still never a name of the tree.
        repository ? files : { ...files, '.git/HEAD': 'ref: refs/heads/main\n' },
        { repository },
      )
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- with Git, then without
      const source = await open(directory, { executable: repository ? 'git' : null })
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- with Git, then without
      const head = await source.head()
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- with Git, then without
      const present = await source.present(head, [
        'docs/setup.md',
        'docs/Setup.md',
        'src',
        'src/run.ts',
        'src/missing.ts',
        'nowhere/at/all.md',
        // Under a file, which no directory listing can hold.
        'docs/setup.md/inner',
        '.git',
        '../escape.md',
      ])
      expect([...present].toSorted()).toEqual(['docs/setup.md', 'src', 'src/run.ts'])
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- with Git, then without
      expect(await source.present(head, ['', './a'])).toEqual(new Set())
    }
  })

  it('lists directories when there is no Git to ask, and leaves a nested store out', async () => {
    const directory = await tree({ 'docs/a.md': '# A\n', 'docs/sub/.git/config': 'x\n' })
    const source = await open(directory, { executable: join(root, 'no-such-git') })
    const head = await source.head()
    expect((await all(source.files(head))).map(({ path }) => path)).toEqual(['docs/a.md'])
    await source.narrow(['docs/a.md', 'missing'])
    expect((await all(source.files(head))).map(({ path }) => path)).toEqual(['docs/a.md'])
    await source.close()
  })

  it('reports a file over the cap by its size, and a file that changed or went as missing', async () => {
    const directory = await tree({ 'docs/big.md': 'x'.repeat(40), 'docs/small.md': '# S\n' })
    const source = await open(directory, { executable: null, maxFileBytes: 16 })
    const head = await source.head()
    const [big, small] = await all(source.files(head))
    expect(big?.fileId).toBe(blobId(Buffer.from('x'.repeat(40))))
    const read: SourceFileContent[] = await all(source.readFiles([big?.fileId ?? '']))
    expect(read).toEqual([{ kind: 'too-large', fileId: big?.fileId, size: 40 }])
    await writeFile(join(directory, 'docs/small.md'), '# Changed\n')
    expect(await failure(all(source.readFiles([small?.fileId ?? ''])))).toBe('file-missing')
    await unlink(join(directory, 'docs/small.md'))
    expect(await failure(all(source.readFiles([small?.fileId ?? ''])))).toBe('file-missing')
    expect(await failure(all(source.readFiles(['f'.repeat(40)])))).toBe('file-missing')
    // It made no home of its own without `git`, so closing has nothing to remove.
    await source.close()
  })
})
