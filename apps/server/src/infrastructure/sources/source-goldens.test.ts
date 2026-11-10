import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  describeManifestProblem,
  organisationVocabulary,
  plannedRenderInput,
  planSourceHead,
  renderDocument,
  SOURCE_MANIFEST_PATH,
  syncSource,
} from '@quill/application'
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
import { collectionId, documentId, userId, workspaceId } from '@quill/domain'
import { afterAll, describe, expect, it } from 'vitest'

import { createDocumentFormat, createDrawioText } from '@quill/format'
import { createHasher } from '../hasher.ts'

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
async function publish(
  name: string,
  fixture: SourceFixture,
  directory: string = name,
): Promise<string> {
  const work = join(root, directory, 'work')
  const bare = join(root, directory, 'remote.git')
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
      tableShapes: rendered.content.tableShapes ?? [],
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

// ---------------------------------------------------------------------------
// The head plan, held to the same golden files
// ---------------------------------------------------------------------------

/** What the head plan of a fixture says, in the golden file's shape, for the parts a plan answers. */
async function planFixture(name: SourceFixtureName): Promise<Record<string, unknown>> {
  const fixture: SourceFixture = SOURCE_FIXTURES[name]
  const remote = await publish(name, fixture, `${name}-plan`)
  const source = await GitCliExternalSource.open({
    remote,
    branch: 'main',
    paths: [SOURCE_MANIFEST_PATH],
    strictPrefixes: false,
    cacheDirectory: join(root, `${name}-plan`, 'cache'),
    outboundPolicy: { check: async () => ({ allowed: true }) },
    allowFileRemotesForTesting: true,
    ...(fixture.maxFileBytes === undefined ? {} : { maxFileBytes: fixture.maxFileBytes }),
  })
  const settings = (fixture.collections ?? []).map(({ slug, path }, index) => ({
    id: collectionId(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`),
    slug,
    path,
  }))
  const minted = createFakeIdGenerator('91a4')
  const attachments = new Map<string, string>()
  const blobStore = createInMemoryBlobStore()
  const format = createDocumentFormat()
  const revision = await source.fetch()
  const plan = await planSourceHead(
    {
      format,
      blobStore,
      drawingText: createDrawioText(),
      maxAssetBytes: 64 * 1024,
      ids: {
        document: () => documentId(minted.uuid()),
        collection: () => collectionId(minted.uuid()),
        attachment: (sha256) => {
          const known = attachments.get(sha256) ?? minted.uuid()
          attachments.set(sha256, known)
          return known
        },
      },
    },
    source,
    {
      revision,
      collections: settings.map(({ id, path }) => ({ collectionId: id, path })),
      entry: FIXTURE_WORKSPACE_SLUG,
      links: { remote: FORGE_REMOTE, outsideLinks: 'forge', viewTemplate: null },
    },
  )
  if (plan.kind === 'unreadable') {
    return {
      failure: `${describeManifestProblem(SOURCE_MANIFEST_PATH, plan.problem)} (at ${revision})`,
    }
  }

  const named = new Map<string, string>([
    ...plan.documents.map((row): [string, string] => [row.documentId, `doc:${row.path}`]),
    ...plan.assets.map((row): [string, string] => [row.attachmentId, `asset:${row.path}`]),
  ])
  const anonymise = (text: string): string =>
    [...named].reduce((written, [id, label]) => written.replaceAll(id, `{${label}}`), text)
  const slugs = new Map<string, { readonly slug: string; readonly title: string }>([
    ...settings.map(({ id, slug }): [string, { slug: string; title: string }] => [
      id,
      { slug, title: slug },
    ]),
    ...plan.collections.flatMap(
      ({ id, collection }): [string, { slug: string; title: string }][] =>
        collection.from === 'manifest'
          ? [[id, { slug: collection.slug, title: collection.title }]]
          : [],
    ),
  ])
  const vocabulary = await organisationVocabulary(createFakeSettings())
  const bodies: Record<string, unknown> = {}
  const stored: Record<string, string> = {}
  for (const document of plan.documents) {
    stored[document.path] = anonymise(document.markdown)
    // oxlint-disable-next-line quill/no-independent-await-in-loop -- one document at a time, as the golden was written
    const input = await plannedRenderInput(plan, document, { blobStore, vocabulary })
    const rendered = format.render(input)
    bodies[document.path] = {
      html: anonymise(rendered.html),
      blockIssues: rendered.blockIssues ?? [],
      tableShapes: rendered.tableShapes ?? [],
      incompleteRequiredSections: rendered.incompleteRequiredSections ?? [],
    }
  }
  return {
    refused: plan.refused.map(({ path, reason }) => ({ path, reason })),
    brokenLinks: plan.brokenLinks.map(({ path, url }) => ({ path, url })),
    layout: {
      origin: plan.layout.origin,
      unknownKeys: plan.layout.unknownKeys,
      collections: plan.collections.flatMap(({ collection }) =>
        collection.from === 'manifest' ? [collection.slug] : [],
      ),
    },
    collections: [...slugs.values()].toSorted((left, right) => (left.slug < right.slug ? -1 : 1)),
    tree: plan.documents.map((document) => ({
      path: document.path,
      collection: slugs.get(document.collectionId)?.slug ?? null,
      parent: document.parent,
      title: document.title,
      sortKey: document.sortKey,
      archived: false,
    })),
    assets: plan.assets.map(({ path }) => path),
    stored,
    bodies,
  }
}

/** The parts of a golden file a head plan answers. */
async function goldenOf(name: SourceFixtureName): Promise<Record<string, unknown>> {
  const golden = JSON.parse(
    await readFile(join(import.meta.dirname, '__goldens__', `${name}.gen.json`), 'utf8'),
  ) as {
    readonly state: {
      readonly failure: { readonly message: string } | null
      readonly refused: unknown
      readonly brokenLinks: unknown
      readonly layout: unknown
    }
    readonly collections: unknown
    readonly tree: unknown
    readonly assets: unknown
    readonly stored: unknown
    readonly bodies: unknown
  }
  const { state } = golden
  if (state.failure !== null) return { failure: state.failure.message }
  return {
    refused: state.refused,
    brokenLinks: state.brokenLinks,
    layout: state.layout,
    collections: golden.collections,
    tree: golden.tree,
    assets: golden.assets,
    stored: golden.stored,
    bodies: golden.bodies,
  }
}

describe('the head plan of each source fixture, against the sync golden files (ADR-062)', () => {
  for (const name of Object.keys(SOURCE_FIXTURES) as SourceFixtureName[]) {
    it(`${name}: the plan decides what the sync wrote`, async () => {
      expect(await planFixture(name)).toEqual(await goldenOf(name))
    }, 60_000)
  }
})
