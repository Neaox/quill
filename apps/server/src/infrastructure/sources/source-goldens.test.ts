import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { renderDocument, SOURCE_MANIFEST_PATH, syncSource } from '@quill/application'
import type {
  RenderDocumentDependencies,
  SourceSettings,
  SyncSourceDependencies,
} from '@quill/application'
import {
  createFakeClock,
  createFakeIdGenerator,
  createFakeSettings,
  createInMemoryBlobStore,
  createInMemoryUnitOfWork,
  FIXTURE_WORKSPACE_SLUG,
  SOURCE_FIXTURES,
} from '@quill/application/test-support'
import type { SourceFixture, SourceFixtureName } from '@quill/application/test-support'
import {
  GitCliExternalSource,
  GitContentStore,
  MemoryObjectStoreProvider,
} from '@quill/content-store'
import { collectionId, userId, workspaceId } from '@quill/domain'
import { afterAll, describe, expect, it } from 'vitest'

import { createDrawioText } from '../../extensions/drawio/drawing-text.ts'
import { createHasher } from '../hasher.ts'
import { createDocumentFormat } from '../markdown/document-format.ts'

/**
 * The server half of ADR-062's parity suite: each repository in
 * `SOURCE_FIXTURES` synced by the sync job as it runs on the server (the real
 * `git` adapter over a `file://` remote, the real Markdown pipeline, a Git
 * content store in memory), its head imported as one revision, and every
 * document rendered as a reader's request renders it.
 *
 * What the sync recorded (refused files, broken links, the layout), the tree
 * it built, the stored copies and the rendered bodies are kept as one golden
 * file per fixture under `__goldens__/`. Ids are replaced by the repository
 * path they belong to, so the file says nothing that depends on how ids were
 * minted. Every later reading of the same repository (the sync's own plan,
 * the command-line tool) is held to these files.
 *
 * Regenerate after a deliberate change with
 * `pnpm --filter @quill/server exec vitest run source-goldens -u`.
 */

const WORKSPACE = workspaceId('00000000-0000-4000-8000-000000000101')
const NOW = new Date('2026-11-10T12:00:00.000Z')
const COMMITTED = '2026-11-01T09:00:00Z'
const ADMIN = userId('00000000-0000-4000-8000-0000000000a1')
/** The remote a forge link is made from; the clone itself reads a local bare repository. */
const FORGE_REMOTE = 'https://github.com/acme/handbook.git'

const root = await mkdtemp(join(tmpdir(), 'quill-source-goldens-'))
afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5 }))

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

/** The fixture as a repository with one commit, published to a bare remote. Returns the remote's URL. */
async function publish(name: string, fixture: SourceFixture): Promise<string> {
  const work = join(root, name, 'work')
  const bare = join(root, name, 'remote.git')
  await mkdir(work, { recursive: true })
  git(work, ['init', '--quiet', '--initial-branch=main'])
  // The bytes as written, on every platform: no line-ending conversion.
  git(work, ['config', 'core.autocrlf', 'false'])
  git(root, ['init', '--quiet', '--bare', '--initial-branch=main', bare])
  git(bare, ['config', 'uploadpack.allowFilter', 'true'])
  const links: [string, string][] = []
  for (const [path, file] of Object.entries(fixture.files)) {
    if (typeof file !== 'string' && file.kind === 'symbolic-link') {
      links.push([path, file.target])
      continue
    }
    await mkdir(dirname(join(work, path)), { recursive: true })
    await writeFile(join(work, path), typeof file === 'string' ? file : file.bytes)
  }
  git(work, ['add', '--all'])
  // A symbolic link goes into the index as one, whatever the checkout can hold.
  for (const [path, target] of links) {
    const id = git(work, ['hash-object', '-w', '--stdin'], target)
    git(work, ['update-index', '--add', '--cacheinfo', `120000,${id},${path}`])
  }
  git(work, ['commit', '--quiet', '--no-verify', '-m', `The ${name} fixture`])
  git(work, ['push', '--quiet', bare, 'HEAD:refs/heads/main'])
  return pathToFileURL(bare).href
}

interface Synced {
  readonly result: unknown
  readonly golden: unknown
}

async function syncFixture(name: SourceFixtureName): Promise<Synced> {
  const fixture: SourceFixture = SOURCE_FIXTURES[name]
  const remote = await publish(name, fixture)
  const uow = createInMemoryUnitOfWork()
  const clock = createFakeClock(NOW)
  await uow.repos.units.create({
    id: 'acme',
    parentId: null,
    name: 'Acme',
    slug: 'acme',
    label: 'company',
    now: NOW,
  })
  await uow.repos.workspaces.create({
    id: WORKSPACE,
    unitId: 'acme',
    name: 'Handbook',
    slug: FIXTURE_WORKSPACE_SLUG,
    now: NOW,
  })
  const collections = (fixture.collections ?? []).map(({ slug, path }, index) => ({
    id: collectionId(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
    slug,
    path,
  }))
  for (const { id, slug } of collections) {
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- a handful of rows, in order
    await uow.repos.collections.create({ id, workspaceId: WORKSPACE, name: slug, slug, now: NOW })
  }
  await uow.repos.workspaceSources.put({
    workspaceId: WORKSPACE,
    remote: FORGE_REMOTE,
    branch: 'main',
    collections: collections.map(({ id, path }) => ({ collectionId: id, path })),
    history: 'head',
    commitMessages: 'subject',
    manifestEntry: null,
    credential: null,
    outsideLinks: 'forge',
    viewTemplate: null,
    webhookSecretName: null,
    configuredBy: ADMIN,
    now: NOW,
  })

  const source = await GitCliExternalSource.open({
    remote,
    branch: 'main',
    paths: [SOURCE_MANIFEST_PATH],
    strictPrefixes: false,
    cacheDirectory: join(root, name, 'cache'),
    outboundPolicy: { check: async () => ({ allowed: true }) },
    allowFileRemotesForTesting: true,
    ...(fixture.maxFileBytes === undefined ? {} : { maxFileBytes: fixture.maxFileBytes }),
  })
  const settings: SourceSettings = {
    collections: collections.map(({ id, path }) => ({ collectionId: id, path })),
    history: 'head',
    commitMessages: 'subject',
    manifestEntry: null,
  }
  const contentStore = new GitContentStore({
    provider: new MemoryObjectStoreProvider(),
    now: () => clock.now(),
    random: () => 0.5,
  })
  const format = createDocumentFormat()
  const blobStore = createInMemoryBlobStore()
  const deps: SyncSourceDependencies = {
    uow,
    contentStore,
    format,
    sources: {
      forWorkspace: async () => ({ source, settings, configuredAt: NOW }),
      withDraft: async () => {
        throw new Error('Not asked for in a sync.')
      },
    },
    lock: {
      withLock: async (_, work) => ({ kind: 'ran', value: await work() }),
      isHeld: async () => false,
    },
    clock,
    ids: createFakeIdGenerator('5eed'),
    blobStore,
    drawingText: createDrawioText(),
    maxAssetBytes: 64 * 1024,
  }
  const result = await syncSource(deps, { workspaceId: WORKSPACE })

  // Every id, by the repository path it stands for.
  const paths = await uow.repos.sourcePaths.listByWorkspace(WORKSPACE)
  const assets = await uow.repos.sourceAssets.listByWorkspace(WORKSPACE)
  const named = new Map<string, string>([
    ...paths.map((row): [string, string] => [row.documentId, `doc:${row.path}`]),
    ...assets.map((row): [string, string] => [row.attachmentId, `asset:${row.path}`]),
  ])
  const pathOf = (id: string | null): string | null =>
    id === null ? null : (paths.find((row) => row.documentId === id)?.path ?? id)
  const anonymise = (text: string): string =>
    [...named].reduce((written, [id, label]) => written.replaceAll(id, `{${label}}`), text)

  const state = await uow.repos.sourceSyncState.find(WORKSPACE)
  const collectionRows = await uow.repos.collections.listByWorkspace(WORKSPACE)
  const slugOf = new Map(collectionRows.map((row) => [row.id, row.slug]))
  const documents = (await uow.repos.documents.listByWorkspace(WORKSPACE))
    .map((row) => ({ row, path: pathOf(row.id) ?? row.id }))
    .toSorted((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))

  const renderDeps: RenderDocumentDependencies = {
    uow,
    contentStore,
    format,
    clock,
    ids: createFakeIdGenerator('7e57'),
    hasher: createHasher(),
    blobStore,
    settings: createFakeSettings(),
  }
  const tree: unknown[] = []
  const bodies: Record<string, unknown> = {}
  const stored: Record<string, string> = {}
  for (const { row, path } of documents) {
    const archived = paths.find((entry) => entry.documentId === row.id)?.archivedAt != null
    tree.push({
      path,
      collection: row.collectionId === null ? null : (slugOf.get(row.collectionId) ?? null),
      parent: pathOf(row.parentId),
      title: row.title,
      sortKey: row.sortKey,
      archived,
    })
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one document at a time keeps the golden's order the reading order
    const read = await contentStore.read(WORKSPACE, row.id)
    if (read !== null) stored[path] = anonymise(read.markdown)
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- as above
    const rendered = await renderDocument(renderDeps, { documentId: row.id })
    if (rendered.kind !== 'rendered') continue
    bodies[path] = {
      html: anonymise(rendered.content.html),
      blockIssues: rendered.content.blockIssues ?? [],
      incompleteRequiredSections: rendered.content.incompleteRequiredSections ?? [],
    }
  }

  const golden = {
    fixture: name,
    result: anonymiseResult(result),
    state:
      state === null
        ? null
        : {
            failure:
              state.failure === null
                ? null
                : { reason: state.failure.reason, message: state.failure.message },
            refused: [...state.refused]
              .map(({ path, reason }) => ({ path, reason }))
              .toSorted((left, right) => (left.path < right.path ? -1 : 1)),
            brokenLinks: (state.brokenLinks ?? []).map(({ path, url }) => ({ path, url })),
            layout:
              state.layout === null
                ? null
                : {
                    origin: state.layout.origin,
                    unknownKeys: state.layout.unknownKeys,
                    collections: state.layout.collectionIds.map(
                      (id) => slugOf.get(collectionId(id)) ?? id,
                    ),
                  },
          },
    collections: collectionRows
      .map((row) => ({ slug: row.slug, title: row.name }))
      .toSorted((left, right) => (left.slug < right.slug ? -1 : 1)),
    tree,
    assets: assets.map(({ path }) => path).toSorted((left, right) => (left < right ? -1 : 1)),
    stored,
    bodies,
  }
  return { result, golden }
}

/** The sync's answer without the commit id, which the golden's file name already pins. */
function anonymiseResult(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result
  const { revision: _revision, ...rest } = result as Record<string, unknown>
  return rest
}

describe('the sync of each source fixture, as golden files (ADR-062)', () => {
  for (const name of Object.keys(SOURCE_FIXTURES) as SourceFixtureName[]) {
    it(`${name}: ${SOURCE_FIXTURES[name].description}`, async () => {
      const { golden } = await syncFixture(name)
      await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot(
        `./__goldens__/${name}.gen.json`,
      )
    }, 60_000)
  }
})
