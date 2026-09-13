/**
 * The content store over a real bare repository on disk: the default
 * self-hosted backend, and the one with the Windows hazards in it.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { GitContentStore } from '../git-content-store.ts'
import {
  AUTHOR,
  JITTER,
  markdown,
  newDocument,
  newWorkspaceId,
  SYSTEM_NOW,
  write,
} from '../test-fixtures.ts'
import { FilesystemObjectStoreProvider, LeakedLockError } from './filesystem-object-store.ts'

const root = await mkdtemp(join(tmpdir(), 'content-store-integration-'))
const providers: FilesystemObjectStoreProvider[] = []
let store: GitContentStore
let provider: FilesystemObjectStoreProvider
let workspace = newWorkspaceId()
let roots = 0

afterAll(async () => {
  await Promise.all(providers.map((each) => each.close()))
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

/** A store with its own provider, so two of them contend like two processes. */
function contentStore(directory: string): GitContentStore {
  const own = new FilesystemObjectStoreProvider(directory, { now: SYSTEM_NOW })
  providers.push(own)
  return new GitContentStore({ provider: own, now: SYSTEM_NOW, random: JITTER })
}

beforeEach(() => {
  roots += 1
  provider = new FilesystemObjectStoreProvider(join(root, `run-${roots}`), { now: SYSTEM_NOW })
  providers.push(provider)
  store = new GitContentStore({ provider, now: SYSTEM_NOW, random: JITTER })
  workspace = newWorkspaceId()
})

describe('a workspace on disk', () => {
  it('publishes, reads, and lists through loose objects', async () => {
    const id = newDocument()
    const first = await store.publish({
      workspaceId: workspace,
      changes: [write(id, 'handbook/onboarding.md', markdown(id, 'Onboarding', 'One.'))],
      author: AUTHOR,
      base: null,
    })
    if (first.kind !== 'published') throw new Error('expected a revision')
    expect(await store.head(workspace)).toBe(first.revision)
    expect((await store.read(workspace, id))?.markdown).toContain('One.')
    expect(await store.listTree(workspace)).toEqual([
      { path: 'handbook/onboarding.md', kind: 'document', documentId: id },
    ])

    const second = await store.publish({
      workspaceId: workspace,
      changes: [write(id, 'handbook/onboarding.md', markdown(id, 'Onboarding', 'Two.'))],
      author: AUTHOR,
      base: first.revision,
    })
    if (second.kind !== 'published') throw new Error('expected a revision')
    const diff = await store.diff(workspace, id, first.revision, second.revision)
    expect(diff.unified).toContain('+Two.')
    expect(await store.history(workspace, id, { limit: 10 })).toHaveLength(2)
  })

  it('writes one bare repository per workspace, named by its id', async () => {
    const id = newDocument()
    const other = newWorkspaceId()
    for (const target of [workspace, other]) {
      await store.publish({
        workspaceId: target,
        changes: [write(id, 'a.md', markdown(id, 'Onboarding'))],
        author: AUTHOR,
        base: null,
      })
    }
    expect((await readdir(join(root, `run-${roots}`))).toSorted()).toEqual(
      [`${workspace}.git`, `${other}.git`].toSorted(),
    )
  })

  it('lets eight concurrent publishers through the lockfile protocol', async () => {
    const first = await store.publish({
      workspaceId: workspace,
      changes: [write(newDocument(), 'seed.md', '# Seed\n')],
      author: AUTHOR,
      base: null,
    })
    if (first.kind !== 'published') throw new Error('expected a revision')
    const ids = Array.from({ length: 8 }, () => newDocument())
    const results = await Promise.all(
      ids.map((id, index) =>
        store.publish({
          workspaceId: workspace,
          changes: [write(id, `docs/${index}.md`, markdown(id, `Document ${index}`))],
          author: AUTHOR,
          base: first.revision,
        }),
      ),
    )
    expect(results.every((result) => result.kind === 'published')).toBe(true)
    expect(await store.listTree(workspace)).toHaveLength(9)
    for (const id of ids) expect(await store.read(workspace, id)).not.toBeNull()
  })
})

/**
 * Two stores over two providers on one directory: separate in-process queues,
 * separate repository handles, one lock file. This is the only arrangement in
 * which the lockfile protocol is the thing being tested — publishes through one
 * store are serialised by its own mutex long before they reach the disk.
 */
describe('two publishers that share nothing but the repository', () => {
  it('lets eight of them through, contending the real lock file', async () => {
    const directory = join(root, `contended-${roots}`)
    const one = contentStore(directory)
    const two = contentStore(directory)
    const seed = await one.publish({
      workspaceId: workspace,
      changes: [write(newDocument(), 'seed.md', '# Seed\n')],
      author: AUTHOR,
      base: null,
    })
    if (seed.kind !== 'published') throw new Error('expected a revision')
    const ids = Array.from({ length: 8 }, () => newDocument())
    const results = await Promise.all(
      ids.map((id, index) =>
        (index % 2 === 0 ? one : two).publish({
          workspaceId: workspace,
          changes: [write(id, `docs/${index}.md`, markdown(id, `Document ${index}`))],
          author: AUTHOR,
          base: seed.revision,
        }),
      ),
    )
    expect(results.map((result) => result.kind)).toEqual(
      Array.from({ length: 8 }, () => 'published'),
    )
    expect(await two.listTree(workspace)).toHaveLength(9)
    for (const id of ids) expect(await one.read(workspace, id)).not.toBeNull()
  })

  it('tells a leaked lock apart from a publisher that is merely slow', async () => {
    const directory = join(root, `leaked-${roots}`)
    const one = contentStore(directory)
    await one.publish({
      workspaceId: workspace,
      changes: [write(newDocument(), 'seed.md', '# Seed\n')],
      author: AUTHOR,
      base: null,
    })
    const lockPath = join(directory, `${workspace}.git`, 'refs', 'heads', 'main.lock')
    await writeFile(lockPath, '')
    const longAgo = new Date(SYSTEM_NOW().getTime() - 10 * 60_000)
    await utimes(lockPath, longAgo, longAgo)
    const failure = await one
      .publish({
        workspaceId: workspace,
        changes: [write(newDocument(), 'b.md', '# Second\n')],
        author: AUTHOR,
        base: await one.head(workspace),
      })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LeakedLockError)
    expect(failure).toMatchObject({ path: lockPath })
    // Never removed behind an operator's back.
    expect(existsSync(lockPath)).toBe(true)
    await rm(lockPath)
  })
})
