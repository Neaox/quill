import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { FilesystemObjectStoreProvider } from './filesystem/filesystem-object-store.ts'
import { GitContentStore } from './git-content-store.ts'
import { MemoryObjectStoreProvider } from './memory-object-store.ts'
import type { WorkspaceId } from '@quill/domain'

import type { ObjectStoreProvider } from './object-store.ts'
import { RefLockPackingHook } from './packing.ts'
import {
  AUTHOR,
  JITTER,
  markdown,
  newDocument,
  newWorkspaceId,
  NOW,
  write,
} from './test-fixtures.ts'

const root = await mkdtemp(join(tmpdir(), 'content-store-packing-'))

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function seeded(provider: ObjectStoreProvider, ref?: string): Promise<WorkspaceId> {
  const store = new GitContentStore({
    provider,
    now: NOW,
    random: JITTER,
    ...(ref === undefined ? {} : { ref }),
  })
  const workspace = newWorkspaceId()
  const id = newDocument()
  const result = await store.publish({
    workspaceId: workspace,
    changes: [write(id, 'a.md', markdown(id, 'Onboarding'))],
    author: AUTHOR,
    base: null,
  })
  if (result.kind !== 'published') throw new Error('expected a revision')
  return workspace
}

describe('RefLockPackingHook', () => {
  it('has nothing to lock in a workspace with no revisions', async () => {
    const provider = new MemoryObjectStoreProvider()
    const workspace = newWorkspaceId()
    let ran = false
    const result = await new RefLockPackingHook(provider).withRefLock(workspace, async () => {
      ran = true
    })
    expect(result).toEqual({ workspaceId: workspace, revision: null, locked: true })
    expect(ran).toBe(false)
  })

  it('runs the pass at the current revision and leaves history alone', async () => {
    const provider = new MemoryObjectStoreProvider()
    const workspace = await seeded(provider)
    const store = new GitContentStore({ provider, now: NOW, random: JITTER })
    const head = await store.head(workspace)
    let ran = false
    const result = await new RefLockPackingHook(provider).withRefLock(workspace, async () => {
      ran = true
    })
    expect(result).toEqual({ workspaceId: workspace, revision: head, locked: true })
    expect(ran).toBe(true)
    expect(await store.head(workspace)).toBe(head)
  })

  it('reports that it could not take the lock, so the pass can be retried', async () => {
    const revision = 'a'.repeat(40)
    const held: ObjectStoreProvider = {
      forWorkspace: async () => ({
        read: async () => null,
        write: async () => undefined,
        writeBatch: async () => undefined,
        has: async () => false,
        readRef: async () => revision,
        casRef: async () => false,
      }),
    }
    let ran = false
    const result = await new RefLockPackingHook(held).withRefLock(newWorkspaceId(), async () => {
      ran = true
    })
    expect(result).toMatchObject({ locked: false, revision })
    expect(ran).toBe(false)
  })

  it('reports a publish that moved the ref while the pass was running', async () => {
    const provider = new MemoryObjectStoreProvider()
    const workspace = await seeded(provider)
    const store = new GitContentStore({ provider, now: NOW, random: JITTER })
    const id = newDocument()
    const result = await new RefLockPackingHook(provider).withRefLock(workspace, async () => {
      await store.publish({
        workspaceId: workspace,
        changes: [write(id, 'b.md', markdown(id, 'Architecture'))],
        author: AUTHOR,
        base: await store.head(workspace),
      })
    })
    expect(result.locked).toBe(false)
  })

  it('serialises passes over one workspace', async () => {
    const provider = new MemoryObjectStoreProvider()
    const workspace = await seeded(provider)
    const hook = new RefLockPackingHook(provider)
    const order: string[] = []
    const slow = hook.withRefLock(workspace, async () => {
      order.push('first in')
      await Promise.resolve()
      order.push('first out')
    })
    const next = hook.withRefLock(workspace, async () => void order.push('second in'))
    await Promise.all([slow, next])
    expect(order).toEqual(['first in', 'first out', 'second in'])
  })

  it('drops the cached packfiles once the work is done, even if it failed', async () => {
    const provider = new FilesystemObjectStoreProvider(join(root, 'packed'), { now: NOW })
    const workspace = await seeded(provider)
    const objects = await provider.forWorkspace(workspace)
    let invalidated = 0
    Object.assign(objects, {
      invalidatePacks: async (): Promise<void> => void (invalidated += 1),
    })
    await expect(
      new RefLockPackingHook(provider).withRefLock(workspace, async () => {
        throw new Error('git gc failed')
      }),
    ).rejects.toThrow('git gc failed')
    expect(invalidated).toBe(1)
    await provider.close()
  })

  it('watches the ref the caller names', async () => {
    const provider = new MemoryObjectStoreProvider()
    const workspace = await seeded(provider, 'refs/heads/content')
    const onDefault = await new RefLockPackingHook(provider).withRefLock(workspace, async () => {})
    const onNamed = await new RefLockPackingHook(provider, 'refs/heads/content').withRefLock(
      workspace,
      async () => {},
    )
    expect(onDefault.revision).toBeNull()
    expect(onNamed.revision).not.toBeNull()
  })
})
