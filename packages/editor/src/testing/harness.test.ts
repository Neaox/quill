import { describe, expect, it } from 'vitest'

import { createEditorTestHarness } from './harness.ts'

describe('the editor test harness', () => {
  it('turns Markdown into the AST the editor opens, and back again', () => {
    const harness = createEditorTestHarness()
    const ast = harness.open('# A heading\n\nSome prose.\n')
    expect(harness.read(ast)).toBe('# A heading\n\nSome prose.\n')
  })

  it('builds an editor state over the published schema', () => {
    const harness = createEditorTestHarness()
    const state = harness.state('# A heading\n')
    expect(state.doc.firstChild?.type.name).toBe('heading')
  })

  it('gives a clock the test moves by hand', () => {
    const harness = createEditorTestHarness()
    let fired = false
    harness.clock.setTimeout(() => {
      fired = true
    }, 100)
    harness.clock.advance(99)
    expect(fired).toBe(false)
    harness.clock.advance(1)
    expect(fired).toBe(true)
  })

  describe('the lock client', () => {
    it('succeeds by default, and records what was asked of it', async () => {
      const { lockClient } = createEditorTestHarness()
      await expect(lockClient.acquire()).resolves.toMatchObject({ status: 'acquired' })
      await expect(lockClient.heartbeat()).resolves.toMatchObject({ status: 'alive' })
      await expect(lockClient.takeover()).resolves.toMatchObject({ status: 'acquired' })
      await expect(lockClient.release()).resolves.toBeUndefined()
      expect(lockClient.calls).toEqual(['acquire', 'heartbeat', 'takeover', 'release'])
    })

    it('answers with what the test queued, in order, then goes back to the default', async () => {
      const { lockClient } = createEditorTestHarness()
      lockClient.heartbeats.push({ status: 'expired' }, { status: 'released' })
      await expect(lockClient.heartbeat()).resolves.toEqual({ status: 'expired' })
      await expect(lockClient.heartbeat()).resolves.toEqual({ status: 'released' })
      await expect(lockClient.heartbeat()).resolves.toMatchObject({ status: 'alive' })

      lockClient.acquires.push({
        status: 'held',
        holder: { userId: 'priya', displayName: 'Priya', expiresAt: 1 },
      })
      await expect(lockClient.acquire()).resolves.toMatchObject({ status: 'held' })

      lockClient.takeovers.push({ status: 'forbidden' })
      await expect(lockClient.takeover()).resolves.toEqual({ status: 'forbidden' })
    })

    it('never answers at all while it is offline, which is what a partition looks like', async () => {
      const { lockClient } = createEditorTestHarness()
      lockClient.offline = true
      const settled = await Promise.race([
        lockClient.heartbeat(),
        Promise.resolve('still waiting' as const),
      ])
      expect(settled).toBe('still waiting')
      expect(lockClient.calls).toEqual(['heartbeat'])
    })
  })

  describe('the draft client', () => {
    it('loads an empty draft, and records what it was asked to save', async () => {
      const { draftClient, open } = createEditorTestHarness()
      await expect(draftClient.load()).resolves.toMatchObject({ draftVersion: 1 })

      const ast = open('A draft.\n')
      await expect(draftClient.save(ast, 1)).resolves.toMatchObject({
        status: 'saved',
        draftVersion: 2,
      })
      expect(draftClient.saves).toEqual([{ ast, expectedVersion: 1 }])
    })

    it('answers with a queued failure without advancing the version', async () => {
      const { draftClient, open } = createEditorTestHarness()
      draftClient.results.push({ status: 'stale_version', currentVersion: 7 })
      await expect(draftClient.save(open('A.\n'), 1)).resolves.toEqual({
        status: 'stale_version',
        currentVersion: 7,
      })
      await expect(draftClient.save(open('A.\n'), 1)).resolves.toMatchObject({ draftVersion: 2 })
    })

    it('answers a load with what the test queued', async () => {
      const { draftClient, open } = createEditorTestHarness()
      draftClient.loads.push({ ast: open('Loaded.\n'), draftVersion: 9, baseRevision: 'abc' })
      await expect(draftClient.load()).resolves.toMatchObject({ draftVersion: 9 })
    })

    it('never answers at all while it is offline', async () => {
      const { draftClient, open } = createEditorTestHarness()
      draftClient.offline = true
      const waiting = Promise.resolve('still waiting' as const)
      expect(await Promise.race([draftClient.load(), waiting])).toBe('still waiting')
      expect(await Promise.race([draftClient.save(open('A.\n'), 1), waiting])).toBe('still waiting')
    })
  })

  it('gives a recovery store that starts empty', () => {
    const { recoveryStore } = createEditorTestHarness()
    expect(recoveryStore.read()).toBeUndefined()
  })
})
