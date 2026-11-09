/**
 * The adapter against real repositories: each suite builds a repository with
 * the real `git` CLI, publishes it as a bare repository, and reads it over
 * `file://` with the test-only option. The claim that matters most — no file
 * contents from outside the source's paths reach the instance — is checked by
 * listing every object the clone holds.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ExternalSourceError } from '@quill/application'
import type {
  OutboundHostPolicy,
  SourceChange,
  SourceFileContent,
  SourceRevision,
} from '@quill/application'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GitCliExternalSource } from './git-cli-external-source.ts'
import type { GitCliExternalSourceOptions } from './git-cli-external-source.ts'

const root = await mkdtemp(join(tmpdir(), 'quill-external-source-'))
afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }))

/** The fixtures' own git, kept away from the machine's configuration (signing, hooks, templates). */
function git(cwd: string, args: readonly string[], options: GitOptions = {}): string {
  return execFileSync('git', args, {
    cwd,
    input: options.input,
    encoding: 'utf8',
    // Kept off the test output; a failure's message carries it.
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: options.author ?? 'Ada Author',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Cy Committer',
      GIT_COMMITTER_EMAIL: 'cy@example.com',
      GIT_AUTHOR_DATE: options.authoredAt ?? '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: options.committedAt ?? options.authoredAt ?? '2026-01-01T00:00:00Z',
      ...options.env,
    },
  }).trim()
}

interface GitOptions {
  readonly input?: string
  readonly author?: string
  readonly authoredAt?: string
  readonly committedAt?: string
  readonly env?: Readonly<Record<string, string>>
}

/** A working repository that publishes to a bare one, as a forge would serve it. */
class SourceRepository {
  readonly work: string
  readonly bare: string

  private constructor(work: string, bare: string) {
    this.work = work
    this.bare = bare
  }

  static async create(name: string): Promise<SourceRepository> {
    const work = join(root, name, 'work')
    const bare = join(root, name, 'remote.git')
    await mkdir(work, { recursive: true })
    git(work, ['init', '--quiet', '--initial-branch=main'])
    git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
    // What a forge allows: partial clone filters.
    git(bare, ['config', 'uploadpack.allowFilter', 'true'])
    return new SourceRepository(work, bare)
  }

  get url(): string {
    return pathToFileURL(this.bare).href
  }

  async write(files: Readonly<Record<string, string>>): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(this.work, path)), { recursive: true })
      await writeFile(join(this.work, path), content)
    }
  }

  /** Stages everything in the working tree, commits, and publishes. */
  commit(message: string, options: GitOptions = {}): string {
    git(this.work, ['add', '--all'])
    return this.commitIndex(message, options)
  }

  /** Commits the index as it stands (for entries a working tree cannot hold), and publishes. */
  commitIndex(message: string, options: GitOptions = {}): string {
    git(this.work, ['commit', '--quiet', '--no-verify', '--allow-empty', '-m', message], options)
    this.publish()
    return git(this.work, ['rev-parse', 'HEAD'])
  }

  /** An index entry with a mode and contents the working tree is not asked to reproduce. */
  stage(mode: '120000' | '160000', path: string, target: string): void {
    const id =
      mode === '120000'
        ? git(this.work, ['hash-object', '-w', '--stdin'], { input: target })
        : target
    git(this.work, ['update-index', '--add', '--cacheinfo', `${mode},${id},${path}`])
  }

  publish(): void {
    git(this.work, ['push', '--quiet', '--force', this.bare, 'HEAD:refs/heads/main'])
  }

  blobAt(revision: string, path: string): string {
    return git(this.work, ['rev-parse', `${revision}:${path}`])
  }

  /** Every blob at a path under `prefix` in any revision reachable from main. */
  blobsUnder(prefix: string): ReadonlySet<string> {
    const revisions = git(this.work, ['rev-list', 'main']).split('\n')
    return new Set(
      revisions.flatMap((revision) =>
        git(this.work, ['ls-tree', '-r', revision, '--', prefix])
          .split('\n')
          .filter((line) => line.includes(' blob '))
          .map((line) => line.split(/\s+/u)[2] ?? ''),
      ),
    )
  }
}

const ALLOW_ALL: OutboundHostPolicy = { check: () => Promise.resolve({ allowed: true }) }

let sources = 0
async function open(
  repository: SourceRepository,
  options: Partial<GitCliExternalSourceOptions> = {},
): Promise<{ source: GitCliExternalSource; cache: string }> {
  sources += 1
  const cache = options.cacheDirectory ?? join(root, `cache-${sources}`)
  const source = await GitCliExternalSource.open({
    remote: repository.url,
    branch: 'main',
    paths: ['docs/guides'],
    cacheDirectory: cache,
    outboundPolicy: ALLOW_ALL,
    allowFileRemotesForTesting: true,
    ...options,
  })
  return { source, cache }
}

/** Every blob the clone in `cache` holds, read without fetching anything. */
function heldBlobs(cache: string): ReadonlySet<string> {
  const listing = git(
    join(cache, 'repository'),
    ['cat-file', '--batch-all-objects', '--batch-check=%(objecttype) %(objectname)'],
    { env: { GIT_NO_LAZY_FETCH: '1' } },
  )
  return new Set(
    listing
      .split('\n')
      .filter((line) => line.startsWith('blob '))
      .map((line) => line.slice('blob '.length)),
  )
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = []
  for await (const item of items) collected.push(item)
  return collected
}

async function refusal(promise: Promise<unknown>): Promise<ExternalSourceError> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof ExternalSourceError))
    throw new Error(`expected a refusal, got ${String(error)}`)
  return error
}

const text = (content: SourceFileContent): string =>
  content.kind === 'content' ? Buffer.from(content.bytes).toString('utf8') : `<${content.kind}>`

const LONG_GUIDE = Array.from({ length: 20 }, (_, line) => `Line ${line} of the long guide.`).join(
  '\n',
)

describe('GitCliExternalSource', () => {
  let repository: SourceRepository
  const revisions: Record<string, string> = {}

  beforeAll(async () => {
    repository = await SourceRepository.create('handbook')
    await repository.write({
      'README.md': 'The root README is outside the source.\n',
      'docs/top.md': 'A file directly in a parent of the source.\n',
      'docs/guides/a.md': '# A\n\nFirst.\n',
      'docs/guides/b.md': `${LONG_GUIDE}\n`,
      'docs/guides/with space.md': 'Spaces survive.\n',
      'docs/other/x.md': '# X\n',
      'packages/p1/README.md': '# P1\n',
      'packages/p1/src.ts': 'export const secret = 1\n',
    })
    revisions['start'] = repository.commit('Start the handbook', {
      authoredAt: '2026-01-01T10:00:00Z',
      committedAt: '2026-01-02T10:00:00Z',
    })

    await repository.write({ 'README.md': 'Changed outside.\n', 'packages/p1/src.ts': 'x\n' })
    revisions['outside'] = repository.commit('Change only code', {
      authoredAt: '2026-01-03T10:00:00Z',
    })

    await repository.write({ 'docs/guides/a.md': '# A\n\nSecond.\n', 'docs/guides/c.md': '# C\n' })
    revisions['edit'] = repository.commit('Edit the guides', {
      author: 'Bo Writer',
      authoredAt: '2026-01-04T10:00:00Z',
    })

    git(repository.work, ['mv', 'docs/guides/b.md', 'docs/guides/renamed.md'])
    git(repository.work, ['mv', 'docs/other/x.md', 'docs/guides/moved-in.md'])
    // Edited as well as moved, so only similarity can find the rename.
    await repository.write({ 'docs/guides/renamed.md': `${LONG_GUIDE}\nOne more line.\n` })
    revisions['move'] = repository.commit('Move two files', { authoredAt: '2026-01-05T10:00:00Z' })

    git(repository.work, ['checkout', '--quiet', '-b', 'side'])
    await repository.write({ 'docs/guides/side.md': '# Side\n' })
    revisions['side'] = repository.commit('Write on a side branch', {
      authoredAt: '2026-01-06T10:00:00Z',
    })
    git(repository.work, ['checkout', '--quiet', 'main'])
    git(repository.work, ['merge', '--quiet', '--no-ff', '-m', 'Merge the side branch', 'side'], {
      authoredAt: '2026-01-07T10:00:00Z',
    })
    repository.publish()
    revisions['merge'] = git(repository.work, ['rev-parse', 'HEAD'])

    git(repository.work, ['rm', '--quiet', 'docs/guides/c.md'])
    repository.stage('120000', 'docs/guides/link', '../../README.md')
    repository.stage('160000', 'docs/guides/vendored', revisions['start'])
    revisions['link'] = repository.commitIndex('Link and vendor', {
      authoredAt: '2026-01-08T10:00:00Z',
    })

    repository.stage('160000', 'docs/guides/vendored', revisions['edit'])
    revisions['bump'] = repository.commitIndex('Bump the vendored commit', {
      authoredAt: '2026-01-09T10:00:00Z',
    })
  })

  const revision = (name: string): string => {
    const id = revisions[name]
    if (id === undefined) throw new Error(`no revision ${name}`)
    return id
  }

  describe('fetching', () => {
    let source: GitCliExternalSource
    let cache: string
    let head: string

    beforeAll(async () => {
      ;({ source, cache } = await open(repository))
      head = await source.fetch()
    })

    it('fetches to the branch head', async () => {
      expect(head).toBe(revision('bump'))
      await expect(source.head()).resolves.toBe(head)
    })

    it('holds exactly the contents under the source paths, in every revision, and nothing else', () => {
      const held = heldBlobs(cache)

      expect(held).toEqual(repository.blobsUnder('docs/guides'))
      // What cone mode would have brought along: the root's files and a parent's.
      expect(held.has(repository.blobAt(revision('start'), 'README.md'))).toBe(false)
      expect(held.has(repository.blobAt(revision('start'), 'docs/top.md'))).toBe(false)
      expect(held.has(repository.blobAt(revision('start'), 'packages/p1/src.ts'))).toBe(false)
    })

    it('says which paths are in the repository at a revision, inside the source or not', async () => {
      const held = heldBlobs(cache)
      const asked = [
        'README.md',
        'docs/guides',
        'docs/guides/a.md',
        'docs/guides/with space.md',
        'docs/other',
        'docs/*.md',
        'missing.md',
        'docs/../README.md',
        'docs//top.md',
        '',
        'README.md',
      ]

      expect([...(await source.present(head, asked))].toSorted()).toEqual([
        'README.md',
        'docs/guides',
        'docs/guides/a.md',
        'docs/guides/with space.md',
      ])
      expect([...(await source.present(revision('start'), ['docs/other/x.md']))]).toEqual([
        'docs/other/x.md',
      ])
      // Names only: nothing was fetched to answer.
      expect(heldBlobs(cache)).toEqual(held)
    })

    it('asks about many paths in batches, and nothing about none', async () => {
      const many = Array.from(
        { length: 400 },
        (_, index) => `missing/${'x'.repeat(30)}-${index}.md`,
      )
      expect([...(await source.present(head, [...many, 'docs/top.md']))]).toEqual(['docs/top.md'])
      expect((await source.present(head, [])).size).toBe(0)
    })

    it('writes no working tree', async () => {
      await expect(readdir(join(cache, 'repository'))).resolves.toEqual(['.git'])
    })

    it('lists the files under the source paths, skipping submodules', async () => {
      const files = await collect(source.files(head))

      expect(files.map(({ path, kind }) => ({ path, kind }))).toEqual([
        { path: 'docs/guides/a.md', kind: 'file' },
        { path: 'docs/guides/link', kind: 'symbolic-link' },
        { path: 'docs/guides/moved-in.md', kind: 'file' },
        { path: 'docs/guides/renamed.md', kind: 'file' },
        { path: 'docs/guides/side.md', kind: 'file' },
        { path: 'docs/guides/with space.md', kind: 'file' },
      ])
      expect(files[0]?.fileId).toBe(repository.blobAt(head, 'docs/guides/a.md'))
    })

    it('finds one file at a revision, and nothing outside the source paths', async () => {
      await expect(source.file(head, 'docs/guides/a.md')).resolves.toEqual({
        path: 'docs/guides/a.md',
        fileId: repository.blobAt(head, 'docs/guides/a.md'),
        kind: 'file',
      })
      await expect(source.file(revision('start'), 'docs/guides/b.md')).resolves.toMatchObject({
        path: 'docs/guides/b.md',
      })
      await expect(source.file(head, 'docs/guides/missing.md')).resolves.toBeNull()
      await expect(source.file(head, 'docs/guides')).resolves.toBeNull()
      await expect(source.file(head, 'README.md')).resolves.toBeNull()
      await expect(refusal(source.file('f'.repeat(40), 'docs/guides/a.md'))).resolves.toMatchObject(
        { reason: 'unknown-revision' },
      )
    })

    it('reads files by id, in the order asked, a symbolic link as its target', async () => {
      const a = repository.blobAt(head, 'docs/guides/a.md')
      const link = repository.blobAt(head, 'docs/guides/link')
      const earlier = repository.blobAt(revision('start'), 'docs/guides/a.md')

      const contents = await collect(source.readFiles([link, a, earlier]))

      expect(contents.map(text)).toEqual(['../../README.md', '# A\n\nSecond.\n', '# A\n\nFirst.\n'])
      expect(contents.map((content) => content.fileId)).toEqual([link, a, earlier])
    })

    it('reads nothing for no ids', async () => {
      await expect(collect(source.readFiles([]))).resolves.toEqual([])
    })

    it('refuses a file from outside the source paths rather than fetching it', async () => {
      const outside = repository.blobAt(head, 'README.md')

      const error = await refusal(collect(source.readFiles([outside])))

      expect(error.reason).toBe('file-missing')
      expect(heldBlobs(cache).has(outside)).toBe(false)
    })

    it('refuses an id that is not a file', async () => {
      const tree = git(repository.work, ['rev-parse', `${head}:docs/guides`])

      await expect(refusal(collect(source.readFiles([tree])))).resolves.toMatchObject({
        reason: 'file-missing',
      })
      await expect(refusal(collect(source.readFiles(['HEAD:README.md'])))).resolves.toMatchObject({
        reason: 'file-missing',
      })
    })

    it('lists the main line oldest first, only revisions that change the source', async () => {
      const history = await collect(source.history(null, head))

      expect(history.map((entry) => entry.subject)).toEqual([
        'Start the handbook',
        'Edit the guides',
        'Move two files',
        'Merge the side branch',
        'Link and vendor',
        'Bump the vendored commit',
      ])
      expect(history[0]).toEqual<SourceRevision>({
        id: revision('start'),
        author: { name: 'Ada Author', email: 'ada@example.com' },
        authoredAt: new Date('2026-01-01T10:00:00Z'),
        committedAt: new Date('2026-01-02T10:00:00Z'),
        subject: 'Start the handbook',
      })
      expect(history[1]?.author.name).toBe('Bo Writer')
    })

    it('lists the revisions after one', async () => {
      const history = await collect(source.history(revision('move'), revision('link')))

      expect(history.map((entry) => entry.id)).toEqual([revision('merge'), revision('link')])
    })

    it('finds a rename by similarity, and a file moved in from outside is added', async () => {
      const changes = await collect(source.changes(revision('edit'), revision('move')))

      expect(changes).toEqual<SourceChange[]>([
        {
          kind: 'added',
          file: {
            path: 'docs/guides/moved-in.md',
            fileId: repository.blobAt(revision('move'), 'docs/guides/moved-in.md'),
            kind: 'file',
          },
        },
        {
          kind: 'renamed',
          fromPath: 'docs/guides/b.md',
          file: {
            path: 'docs/guides/renamed.md',
            fileId: repository.blobAt(revision('move'), 'docs/guides/renamed.md'),
            kind: 'file',
          },
        },
      ])
    })

    it('reports modified, added and removed files, and ignores submodules', async () => {
      const edit = await collect(source.changes(revision('start'), revision('edit')))
      const link = await collect(source.changes(revision('merge'), revision('link')))
      const bump = await collect(source.changes(revision('link'), revision('bump')))

      expect(
        edit.map((change) => [change.kind, 'file' in change ? change.file.path : change.path]),
      ).toEqual([
        ['modified', 'docs/guides/a.md'],
        ['added', 'docs/guides/c.md'],
      ])
      expect(link).toEqual([
        { kind: 'removed', path: 'docs/guides/c.md' },
        {
          kind: 'added',
          file: {
            path: 'docs/guides/link',
            fileId: repository.blobAt(revision('link'), 'docs/guides/link'),
            kind: 'symbolic-link',
          },
        },
      ])
      expect(bump).toEqual([])
    })

    it('reports every file as added when there is no earlier revision', async () => {
      const changes = await collect(source.changes(null, revision('start')))

      expect(changes.map((change) => change.kind === 'added' && change.file.path)).toEqual([
        'docs/guides/a.md',
        'docs/guides/b.md',
        'docs/guides/with space.md',
      ])
    })

    it('refuses a revision it has not fetched, and anything that is not a revision id', async () => {
      const unknown = 'f'.repeat(40)

      await expect(refusal(collect(source.files(unknown)))).resolves.toMatchObject({
        reason: 'unknown-revision',
      })
      await expect(refusal(collect(source.history(null, '--all')))).resolves.toMatchObject({
        reason: 'unknown-revision',
      })
      await expect(refusal(collect(source.changes('HEAD', head)))).resolves.toMatchObject({
        reason: 'unknown-revision',
      })
    })
  })

  describe('narrowing', () => {
    it('widens to a glob by its directory and fetches the history under it', async () => {
      const { source, cache } = await open(repository, { paths: ['.quill/workspace.yaml'] })
      // Before the first fetch there is no clone to narrow: the fetch takes the paths.
      await source.narrow(['docs/guides'])
      const head = await source.fetch()
      expect(heldBlobs(cache)).toEqual(repository.blobsUnder('docs/guides'))

      await source.narrow(['docs/guides', 'packages/**/README.md'])

      const held = heldBlobs(cache)
      for (const blob of repository.blobsUnder('packages')) expect(held.has(blob)).toBe(true)
      expect(held.has(repository.blobAt(revision('start'), 'README.md'))).toBe(false)
      const files = await collect(source.files(head))
      expect(files.map(({ path }) => path)).toContain('packages/p1/README.md')
      expect(files.map(({ path }) => path)).toContain('packages/p1/src.ts')

      // The same paths again fetch nothing more.
      await source.narrow(['packages/**/README.md', 'docs/guides'])
      expect(heldBlobs(cache)).toEqual(held)
      // Narrower paths list less, and keep what is held.
      await source.narrow(['docs/guides'])
      expect((await collect(source.files(head))).map(({ path }) => path)).not.toContain(
        'packages/p1/README.md',
      )
    })

    it('refuses a path it cannot read, and a glob when its prefixes are strict', async () => {
      const { source } = await open(repository)
      await expect(refusal(source.narrow(['../outside']))).resolves.toMatchObject({
        reason: 'invalid-path',
      })
      const strict = (await open(repository, { strictPrefixes: true })).source
      await expect(refusal(strict.narrow(['packages/**/README.md']))).resolves.toMatchObject({
        reason: 'invalid-path',
      })
    })
  })

  describe('a source that changes', () => {
    it('fetches new revisions, and the history of a path added to the source', async () => {
      const growing = await SourceRepository.create('growing')
      await growing.write({ 'docs/a.md': 'one\n', 'api/b.md': 'api one\n', 'secret/c.md': 'no\n' })
      const first = growing.commit('One')
      const { source, cache } = await open(growing, { paths: ['docs'] })
      await expect(source.fetch()).resolves.toBe(first)

      await growing.write({ 'docs/a.md': 'two\n', 'api/b.md': 'api two\n' })
      const second = growing.commit('Two')
      await expect(source.fetch()).resolves.toBe(second)
      expect(heldBlobs(cache)).toEqual(growing.blobsUnder('docs'))

      const { source: wider } = await open(growing, {
        paths: ['docs', 'api'],
        cacheDirectory: cache,
      })
      await wider.fetch()
      expect(heldBlobs(cache)).toEqual(
        new Set([...growing.blobsUnder('docs'), ...growing.blobsUnder('api')]),
      )
      expect(heldBlobs(cache).has(growing.blobAt(first, 'secret/c.md'))).toBe(false)
    })

    it('fetches from the remote it was given, when the source has moved', async () => {
      const original = await SourceRepository.create('moving')
      await original.write({ 'docs/a.md': 'one\n' })
      original.commit('One')
      const { source, cache } = await open(original, { paths: ['docs'] })
      await source.fetch()

      const moved = await SourceRepository.create('moved')
      await moved.write({ 'docs/a.md': 'two\n' })
      const elsewhere = moved.commit('Somewhere else')
      const { source: followed } = await open(original, {
        remote: moved.url,
        paths: ['docs'],
        cacheDirectory: cache,
      })

      await expect(followed.fetch()).resolves.toBe(elsewhere)
    })

    it('says the history was rewritten when the last revision is no longer an ancestor', async () => {
      const rewritten = await SourceRepository.create('rewritten')
      await rewritten.write({ 'docs/a.md': 'one\n' })
      const first = rewritten.commit('One')
      await rewritten.write({ 'docs/a.md': 'two\n' })
      const second = rewritten.commit('Two')
      const { source } = await open(rewritten, { paths: ['docs'] })
      await source.fetch()

      git(rewritten.work, ['reset', '--quiet', '--hard', first])
      await rewritten.write({ 'docs/a.md': 'another two\n' })
      const replacement = rewritten.commit('Two, again')
      await expect(source.fetch()).resolves.toBe(replacement)

      const error = await refusal(collect(source.history(second, replacement)))
      expect(error.reason).toBe('history-rewritten')
      // The old revision is still held, so the sync job can compare against it.
      const changes = await collect(source.changes(second, replacement))
      expect(changes.map((change) => change.kind)).toEqual(['modified'])
    })

    it('widens a glob to its directory, and refuses globs when strict', async () => {
      const packages = await SourceRepository.create('packages')
      await packages.write({
        'packages/one/README.md': '# One\n',
        'packages/one/index.ts': 'export {}\n',
        'docs/a.md': '# A\n',
      })
      const head = packages.commit('Packages')

      const { source, cache } = await open(packages, { paths: ['packages/**/README.md'] })
      await source.fetch()
      expect(heldBlobs(cache)).toEqual(packages.blobsUnder('packages'))
      expect(heldBlobs(cache).has(packages.blobAt(head, 'docs/a.md'))).toBe(false)

      const error = await refusal(
        open(packages, { paths: ['packages/**/README.md'], strictPrefixes: true }),
      )
      expect(error.reason).toBe('invalid-path')
    })

    it('reports a file over the size cap without reading it', async () => {
      const large = await SourceRepository.create('large')
      await large.write({ 'docs/big.md': 'x'.repeat(5000), 'docs/small.md': 'small\n' })
      const head = large.commit('Sizes')
      const { source } = await open(large, { paths: ['docs'], maxFileBytes: 1000 })
      await source.fetch()

      const contents = await collect(
        source.readFiles([large.blobAt(head, 'docs/big.md'), large.blobAt(head, 'docs/small.md')]),
      )

      expect(contents).toEqual([
        { kind: 'too-large', fileId: large.blobAt(head, 'docs/big.md'), size: 5000 },
        {
          kind: 'content',
          fileId: large.blobAt(head, 'docs/small.md'),
          bytes: expect.anything() as unknown,
        },
      ])
    })

    it('stops a listing larger than the output cap', async () => {
      const many = await SourceRepository.create('many')
      await many.write(
        Object.fromEntries(
          Array.from({ length: 50 }, (_, index) => [`docs/${index}.md`, `${index}\n`]),
        ),
      )
      const head = many.commit('Many')
      const { source } = await open(many, { paths: ['docs'], maxOutputBytes: 1000 })
      await source.fetch()

      await expect(refusal(collect(source.files(head)))).resolves.toMatchObject({
        reason: 'output-too-large',
      })
    })
  })

  describe('refusals', () => {
    let published: SourceRepository

    beforeAll(async () => {
      published = await SourceRepository.create('refusals')
      await published.write({ 'docs/a.md': '# A\n' })
      published.commit('A')
    })

    it.each([
      ['plain http', 'http://git.example.com/docs.git'],
      ['ssh', 'ssh://git@git.example.com/docs.git'],
      ['scp-like ssh', 'git@git.example.com:docs.git'],
      ['git protocol', 'git://git.example.com/docs.git'],
      ['credentials in the URL', 'https://user:ghp_secret@git.example.com/docs.git'],
    ])('refuses a %s remote', async (_, remote) => {
      const error = await refusal(open(published, { remote }))

      expect(error.reason).toBe('remote-not-allowed')
      expect(error.message).not.toContain('ghp_secret')
    })

    it('refuses a file remote unless the test-only option allows it', async () => {
      const error = await refusal(open(published, { allowFileRemotesForTesting: false }))

      expect(error.reason).toBe('remote-not-allowed')
    })

    it.each(['-upload-pack=evil', 'a..b', 'main.lock', 'with space', ''])(
      'refuses the branch name %j',
      async (branch) => {
        await expect(refusal(open(published, { branch }))).resolves.toMatchObject({
          reason: 'branch-not-found',
        })
      },
    )

    it.each([[['../outside']], [['/absolute']], [['docs\\windows']], [[]], [['**/*.md']]])(
      'refuses the paths %j',
      async (paths) => {
        await expect(refusal(open(published, { paths }))).resolves.toMatchObject({
          reason: 'invalid-path',
        })
      },
    )

    it('says when the branch does not exist', async () => {
      const { source } = await open(published, { branch: 'gone' })

      await expect(refusal(source.head())).resolves.toMatchObject({ reason: 'branch-not-found' })
    })

    it('leaves no clone behind when the clone fails', async () => {
      const { source, cache } = await open(published, { branch: 'gone' })

      await expect(refusal(source.fetch())).resolves.toMatchObject({ reason: 'command-failed' })
      await expect(readdir(cache)).resolves.toEqual(['home'])
    })

    it('asks the outbound policy before reaching the remote, and stops when it refuses', async () => {
      const asked: string[] = []
      const policy: OutboundHostPolicy = {
        check: (url) => {
          asked.push(url.href)
          return Promise.resolve({ allowed: false, reason: 'resolves to 10.0.0.12' })
        },
      }
      const { source, cache } = await open(published, {
        remote: 'https://git.internal.example/docs.git',
        outboundPolicy: policy,
      })

      const fetched = await refusal(source.fetch())
      const head = await refusal(source.head())

      expect([fetched.reason, head.reason]).toEqual([
        'blocked-by-outbound-policy',
        'blocked-by-outbound-policy',
      ])
      expect(fetched.message).toContain('10.0.0.12')
      expect(asked).toEqual([
        'https://git.internal.example/docs.git',
        'https://git.internal.example/docs.git',
      ])
      await expect(readdir(cache)).resolves.toEqual(['home'])
    })

    it('stops a whole fetch at its deadline, and leaves no clone behind', async () => {
      const { source, cache } = await open(published, {
        paths: ['docs'],
        fetchDeadlineMs: 1,
        networkTimeoutMs: 60_000,
      })

      const error = await refusal(source.fetch())

      expect(error.reason).toBe('timeout')
      expect(error.message).toContain('the fetch did not finish within its deadline of 1 ms')
      await expect(readdir(cache)).resolves.toEqual(['home'])
    })

    it('says git could not be run when there is no git', async () => {
      const error = await refusal(open(published, { executable: join(root, 'no-such-git') }))

      expect(error.reason).toBe('git-unavailable')
    })

    it('accepts its limits and an egress proxy', async () => {
      const { source } = await open(published, {
        paths: ['docs'],
        egressProxy: 'http://proxy.internal:3128',
        localTimeoutMs: 30_000,
        networkTimeoutMs: 30_000,
      })

      await expect(source.fetch()).resolves.toMatch(/^[0-9a-f]{40}$/u)
    })
  })
})
