import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { planSourceHead, SOURCE_MANIFEST_PATH } from '@quill/application'
import type { ExternalSource, SourceHeadPlanDependencies } from '@quill/application'
import {
  createInMemoryBlobStore,
  FIXTURE_WORKSPACE_SLUG,
  SOURCE_FIXTURES,
} from '@quill/application/test-support'
import type { SourceFixture, SourceFixtureName } from '@quill/application/test-support'
import { collectionId, documentId } from '@quill/domain'
import { extractLinks, extractText, parseDocument, stampDocumentId } from '@quill/markdown'
import { afterAll, describe, expect, it } from 'vitest'

import { GitCliExternalSource } from './git-cli-external-source.ts'
import { LocalRevisionSource } from './local-revision-source.ts'
import { WorkingTreeSource } from './working-tree-source.ts'

/**
 * ADR-062's parity for the local adapters: every golden fixture, read
 * through the server's own `GitCliExternalSource` and through each local
 * adapter, plans the same (`planSourceHead`), field by field. Only the
 * revision id differs (a working tree's is a digest of its listing), so it
 * is replaced by a placeholder before comparing.
 *
 * The working tree is read three ways:
 * - with `git`, its files written as a checkout with `core.symlinks=false`
 *   writes them: a link is a plain file holding its target, and the index
 *   says it is a link;
 * - without `git`, a copy with real symbolic links, where the platform lets
 *   the test make them;
 * - at a revision, through `LocalRevisionSource`.
 */

const root = await mkdtemp(join(tmpdir(), 'quill-local-sources-'))
afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }))

const FORGE_REMOTE = 'https://github.com/acme/handbook.git'
const COMMITTED = '2026-11-01T09:00:00Z'

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
      GIT_COMMITTER_NAME: 'Cy Committer',
      GIT_COMMITTER_EMAIL: 'cy@example.com',
      GIT_AUTHOR_DATE: COMMITTED,
      GIT_COMMITTER_DATE: COMMITTED,
    },
  }).trim()
}

const fileBytes = (file: Exclude<SourceFixture['files'][string], { kind: 'symbolic-link' }>) =>
  typeof file === 'string' ? file : file.bytes

/**
 * The fixture committed in a working tree whose links are plain files (as
 * `core.symlinks=false` checks them out), and published to a bare remote.
 */
async function commitFixture(name: string, fixture: SourceFixture) {
  const work = join(root, name, 'work')
  const bare = join(root, name, 'remote.git')
  await mkdir(work, { recursive: true })
  git(work, ['init', '--quiet', '--initial-branch=main'])
  git(work, ['config', 'core.autocrlf', 'false'])
  git(work, ['config', 'core.symlinks', 'false'])
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  git(bare, ['config', 'uploadpack.allowFilter', 'true'])
  const links: [string, string][] = []
  for (const [path, file] of Object.entries(fixture.files)) {
    await mkdir(dirname(join(work, path)), { recursive: true })
    if (typeof file !== 'string' && file.kind === 'symbolic-link') {
      links.push([path, file.target])
      // oxlint-disable-next-line quill/no-independent-await-in-loop -- a handful of files, in order
      await writeFile(join(work, path), file.target)
      continue
    }
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- a handful of files, in order
    await writeFile(join(work, path), fileBytes(file))
  }
  git(work, ['add', '--all'])
  for (const [path, target] of links) {
    const id = git(work, ['hash-object', '-w', '--stdin'], target)
    git(work, ['update-index', '--add', '--cacheinfo', `120000,${id},${path}`])
  }
  git(work, ['commit', '--quiet', '--no-verify', '-m', `The ${name} fixture`])
  git(work, ['push', '--quiet', bare, 'HEAD:refs/heads/main'])
  return { work, remote: pathToFileURL(bare).href }
}

/** The fixture as plain files and real links, with no repository; null where links cannot be made. */
async function plainCopy(name: string, fixture: SourceFixture): Promise<string | null> {
  const copy = join(root, name, 'copy')
  for (const [path, file] of Object.entries(fixture.files)) {
    const location = join(copy, path)
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- a handful of files, in order
    await mkdir(dirname(location), { recursive: true })
    if (typeof file !== 'string' && file.kind === 'symbolic-link') {
      try {
        // oxlint-disable-next-line quill/no-independent-await-in-loop -- a handful of files, in order
        await symlink(file.target, location)
      } catch {
        // Windows without the privilege to make one.
        return null
      }
      continue
    }
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- a handful of files, in order
    await writeFile(location, fileBytes(file))
  }
  return copy
}

const uuid = (name: string) => {
  const hex = createHash('sha256').update(name).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * The parts of the server's `DocumentFormat` a plan asks for, from
 * `@quill/markdown` as the server's adapter takes them. Every adapter is
 * planned with this same one, so whatever it reads, it reads alike.
 */
const format: SourceHeadPlanDependencies['format'] = {
  inspect(markdown) {
    const { frontMatter, ast } = parseDocument(markdown)
    const declared = frontMatter['title']
    return {
      view: {
        frontMatter,
        title:
          typeof declared === 'string' && declared.length > 0 ? declared : extractText(ast).title,
      },
      links: extractLinks(ast).map(({ kind, url, text, external }) => ({
        kind,
        url,
        text,
        external,
      })),
    }
  },
  stampIdentity: (markdown, id) => stampDocumentId(markdown, id),
}

function dependencies(): SourceHeadPlanDependencies {
  return {
    format,
    blobStore: createInMemoryBlobStore(),
    drawingText: { read: async () => null },
    maxAssetBytes: 64 * 1024,
    ids: {
      document: (path) => documentId(uuid(`d-${path}`)),
      collection: (slug) => collectionId(uuid(`c-${slug}`)),
      attachment: (sha256) => sha256,
    },
  }
}

/** The plan, as plain data, with the revision it was made at replaced. */
async function plan(fixture: SourceFixture, source: ExternalSource): Promise<unknown> {
  const revision = await source.fetch()
  const planned = await planSourceHead(dependencies(), source, {
    revision,
    collections: (fixture.collections ?? []).map(({ slug, path }) => ({
      collectionId: collectionId(uuid(`c-${slug}`)),
      path,
    })),
    entry: FIXTURE_WORKSPACE_SLUG,
    links: { remote: FORGE_REMOTE, outsideLinks: 'forge', viewTemplate: null },
  })
  return JSON.parse(JSON.stringify(planned).replaceAll(revision, '<revision>'))
}

const START = [SOURCE_MANIFEST_PATH]

describe.each(Object.keys(SOURCE_FIXTURES) as SourceFixtureName[])('the %s fixture', (name) => {
  const fixture: SourceFixture = SOURCE_FIXTURES[name]
  const cap = fixture.maxFileBytes === undefined ? {} : { maxFileBytes: fixture.maxFileBytes }

  it('plans the same through every local adapter as through the server’s', async () => {
    const { work, remote } = await commitFixture(name, fixture)
    const server = await GitCliExternalSource.open({
      remote,
      branch: 'main',
      paths: START,
      strictPrefixes: false,
      cacheDirectory: join(root, name, 'cache'),
      outboundPolicy: { check: async () => ({ allowed: true }) },
      allowFileRemotesForTesting: true,
      ...cap,
    })
    const expected = await plan(fixture, server)

    const revision = await LocalRevisionSource.open({
      repository: work,
      revision: 'HEAD',
      paths: START,
      ...cap,
    })
    expect(await plan(fixture, revision)).toEqual(expected)
    await revision.close()

    const now = () => new Date(COMMITTED)
    const tree = await WorkingTreeSource.open({ root: work, paths: START, now, ...cap })
    expect(await plan(fixture, tree)).toEqual(expected)
    await tree.close()

    // Where the platform will not make a link, the copy cannot hold the fixture, and the
    // listing without Git is held to the same plan where it can.
    const copy = await plainCopy(name, fixture)
    const listed =
      copy === null
        ? expected
        : await plan(
            fixture,
            await WorkingTreeSource.open({
              root: copy,
              paths: START,
              executable: null,
              now,
              ...cap,
            }),
          )
    expect(listed).toEqual(expected)
  })
})
