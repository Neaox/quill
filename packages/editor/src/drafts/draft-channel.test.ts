import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DraftSavedMessage } from './draft-channel.ts'
import { createBroadcastDraftChannel, createMemoryDraftChannels } from './draft-channel.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createBroadcastDraftChannel', () => {
  it('tells the other tabs of the browser, and never the tab that saved', async () => {
    const tabA = createBroadcastDraftChannel('quill-draft:doc-1')
    const tabB = createBroadcastDraftChannel('quill-draft:doc-1')
    const heardByA: DraftSavedMessage[] = []
    const heardByB: DraftSavedMessage[] = []
    const leaveA = tabA.subscribe((message) => heardByA.push(message))
    const leaveB = tabB.subscribe((message) => heardByB.push(message))

    tabA.publish({ draftVersion: 4 })

    await vi.waitFor(() => {
      expect(heardByB).toEqual([{ draftVersion: 4 }])
    })
    expect(heardByA).toEqual([])
    leaveA()
    leaveB()
  })

  it('ignores anything on the channel that is not a saved draft', async () => {
    const tab = createBroadcastDraftChannel('quill-draft:doc-2')
    const heard: DraftSavedMessage[] = []
    const leave = tab.subscribe((message) => heard.push(message))
    const stranger = new BroadcastChannel('quill-draft:doc-2')
    const post = (message: unknown) => {
      // A BroadcastChannel takes no target origin; the rule is for `window`.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      stranger.postMessage(message)
    }

    post({ hello: 'there' })
    post(null)
    post({ draftVersion: 7 })

    await vi.waitFor(() => {
      expect(heard).toEqual([{ draftVersion: 7 }])
    })
    stranger.close()
    leave()
  })

  it('keeps publishing through a later subscription when an earlier one leaves', async () => {
    const tab = createBroadcastDraftChannel('quill-draft:doc-3')
    const listener = createBroadcastDraftChannel('quill-draft:doc-3')
    const heard: number[] = []
    const leaveListener = listener.subscribe(({ draftVersion }) => heard.push(draftVersion))
    const leaveFirst = tab.subscribe(() => {})
    const leaveSecond = tab.subscribe(() => {})

    // StrictMode's first subscription leaving must not silence the second.
    leaveFirst()
    tab.publish({ draftVersion: 1 })
    await vi.waitFor(() => {
      expect(heard).toEqual([1])
    })

    leaveSecond()
    tab.publish({ draftVersion: 2 })
    leaveListener()
  })

  it('does nothing where the browser has no BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const tab = createBroadcastDraftChannel('quill-draft:doc-4')

    const leave = tab.subscribe(() => {})
    tab.publish({ draftVersion: 1 })
    expect(leave).not.toThrow()
  })
})

describe('createMemoryDraftChannels', () => {
  it('reaches the other channels and stops reaching one that left', () => {
    const channels = createMemoryDraftChannels()
    const a = channels.channel()
    const b = channels.channel()
    const heard: number[] = []
    const leave = b.subscribe(({ draftVersion }) => heard.push(draftVersion))

    a.publish({ draftVersion: 1 })
    leave()
    a.publish({ draftVersion: 2 })

    expect(heard).toEqual([1])
  })
})
