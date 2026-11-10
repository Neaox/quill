import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { ExternalSourceError } from '@quill/application'
import type { SourceChange } from '@quill/application'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { GitCli } from './git-cli.ts'
import { LocalRevisionSource } from './local-revision-source.ts'

const root = await mkdtemp(join(tmpdir(), 'quill-local-revision-'))
afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }))

const work = join(root, 'work')
let first: string
let second: string

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
      GIT_AUTHOR_DATE: '2026-11-01T09:00:00Z',
      GIT_COMMITTER_NAME: 'Cy Committer',
      GIT_COMMITTER_EMAIL: 'cy@example.com',
      GIT_COMMITTER_DATE: '2026-11-02T09:00:00Z',
    },
  }).trim()
}

async function commit(message: string, files: Readonly<Record<string, string>>): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(work, path)), { recursive: true })
    await writeFile(join(work, path), content)
  }
  git(work, ['add', '--all'])
  git(work, ['commit', '--quiet', '--no-verify', '-m', message])
  return git(work, ['rev-parse', 'HEAD'])
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

beforeAll(async () => {
  await mkdir(work, { recursive: true })
  git(work, ['init', '--quiet', '--initial-branch=main'])
  git(work, ['config', 'core.autocrlf', 'false'])
  first = await commit('Write the guide\n\nWith a body that is not the subject.', {
    'docs/guide.md': '# Guide\n',
    'docs/moved.md': '# Moved\n',
    'notes/n.md': '# Note\n',
  })
  // A hook that would leave a mark if anything ran it.
  await writeFile(join(work, '.git/hooks/post-checkout'), '#!/bin/sh\ntouch hooked\n')
  second = await commit('Revise the guide, and move a page', {
    'docs/guide.md': '# Guide, revised\n',
    'docs/new.md': '# New\n',
  })
  git(work, ['mv', 'docs/moved.md', 'docs/renamed.md'])
  // A submodule's commit, which is not a file of the source.
  git(work, ['update-index', '--add', '--cacheinfo', `160000,${'b'.repeat(40)},docs/module`])
  git(work, ['commit', '--quiet', '--no-verify', '-m', 'Move a page'])
})

describe('a revision of a local repository as a source', () => {
  it('reads one revision: its files, its contents and its one commit', async () => {
    const source = await LocalRevisionSource.open({
      repository: work,
      revision: second,
      paths: ['docs'],
    })
    const head = await source.fetch()
    expect(head).toBe(second)
    expect(await source.head()).toBe(second)
    const files = await all(source.files(head))
    expect(files.map(({ path }) => path)).toEqual(['docs/guide.md', 'docs/moved.md', 'docs/new.md'])
    const [content] = await all(source.readFiles([files[0]?.fileId ?? '']))
    expect(content?.kind === 'content' && Buffer.from(content.bytes).toString()).toBe(
      '# Guide, revised\n',
    )
    expect(await all(source.history(null, head))).toEqual([
      {
        id: second,
        author: { name: 'Ada Author', email: 'ada@example.com' },
        authoredAt: new Date('2026-11-01T09:00:00Z'),
        committedAt: new Date('2026-11-02T09:00:00Z'),
        subject: 'Revise the guide, and move a page',
      },
    ])
    expect(await all(source.history(head, head))).toEqual([])
    expect(await failure(all(source.history(first, head)))).toBe('unknown-revision')
    expect(await failure(all(source.files(first)))).toBe('unknown-revision')
    await source.close()
  })

  it('takes a revision by name, and its paths as the server takes them', async () => {
    const source = await LocalRevisionSource.open({
      repository: work,
      revision: 'HEAD~1',
      paths: ['docs/**/*.md'],
    })
    const head = await source.head()
    expect(head).toBe(second)
    expect(await source.file(head, 'notes/n.md')).toBeNull()
    await source.narrow(['docs', 'notes'])
    expect(await source.file(head, 'notes/n.md')).toMatchObject({ kind: 'file' })
    expect(await source.file(head, 'notes/missing.md')).toBeNull()
    expect(await failure(source.narrow(['../out']))).toBe('invalid-path')
  })

  it('compares two listings by path, a move being a removal and an addition', async () => {
    const source = await LocalRevisionSource.open({
      repository: work,
      revision: 'HEAD',
      paths: ['docs'],
    })
    const head = await source.head()
    const changes: SourceChange[] = await all(source.changes(null, head))
    expect(changes.every(({ kind }) => kind === 'added')).toBe(true)
    // A directory, or a submodule, is not a file.
    expect(changes.map((change) => 'file' in change && change.file.path)).not.toContain(
      'docs/module',
    )
    expect(await source.file(head, 'docs')).toBeNull()
    expect(await source.file(head, 'docs/module')).toBeNull()
    expect(await all(source.changes(head, head))).toEqual([])
  })

  it('answers which paths are there from the revision’s names, anywhere in it', async () => {
    const source = await LocalRevisionSource.open({
      repository: work,
      revision: first,
      paths: ['docs'],
    })
    const head = await source.head()
    expect(
      [
        ...(await source.present(head, [
          'notes/n.md',
          'notes',
          'Notes/n.md',
          'docs/x.md',
          '../up',
        ])),
      ].toSorted(),
    ).toEqual(['notes', 'notes/n.md'])
    expect(await source.present(head, ['', '..'])).toEqual(new Set())
  })

  it('refuses a revision that is not a commit, or reads as an option', async () => {
    const open = (revision: string) =>
      failure(LocalRevisionSource.open({ repository: work, revision, paths: ['docs'] }))
    expect(await open('no-such-branch')).toBe('unknown-revision')
    expect(await open('--output=x')).toBe('unknown-revision')
    expect(await open('main two')).toBe('unknown-revision')
    expect(
      await failure(
        LocalRevisionSource.open({ repository: work, revision: 'HEAD', paths: ['/x'] }),
      ),
    ).toBe('invalid-path')
  })

  it('refuses a file id it does not hold, and reports one over the cap by its size', async () => {
    const source = await LocalRevisionSource.open({
      repository: work,
      revision: first,
      paths: ['docs'],
      maxFileBytes: 4,
    })
    const head = await source.head()
    const [guide] = await all(source.files(head))
    expect(await all(source.readFiles([guide?.fileId ?? '']))).toEqual([
      { kind: 'too-large', fileId: guide?.fileId, size: 8 },
    ])
    expect(await all(source.readFiles([]))).toEqual([])
    expect(await failure(all(source.readFiles(['not-an-id'])))).toBe('file-missing')
    expect(await failure(all(source.readFiles(['0'.repeat(40)])))).toBe('file-missing')
    // A commit is not a file.
    expect(await failure(all(source.readFiles([first])))).toBe('file-missing')
  })

  it('runs rev-parse, ls-tree and cat-file and nothing else, and no hook', async () => {
    const stream = vi.spyOn(GitCli.prototype, 'stream')
    const source = await LocalRevisionSource.open({
      repository: work,
      revision: 'HEAD',
      paths: ['docs'],
    })
    const head = await source.fetch()
    await source.narrow(['docs', 'notes'])
    await source.file(head, 'docs/guide.md')
    await source.present(head, ['docs'])
    await all(source.history(null, head))
    await all(source.changes(null, head))
    const files = await all(source.files(head))
    await all(source.readFiles(files.map(({ fileId }) => fileId)))
    const ran = new Set(stream.mock.calls.map(([command]) => command.subcommand))
    stream.mockRestore()
    expect([...ran].toSorted()).toEqual(['cat-file', 'ls-tree', 'rev-parse'])
    await expect(readFile(join(work, 'hooked'))).rejects.toThrow(/ENOENT/u)
  })
})
