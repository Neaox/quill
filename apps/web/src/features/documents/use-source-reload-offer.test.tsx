import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { toast, type ToastPromiseMessages } from '@quill/ui'

import { createHookWrapper } from '../../lib/api/hook-wrapper.tsx'
import { SOURCE_FRESHNESS_REFRESH_MS } from '../../lib/api/index.ts'
import { jsonResponse } from '../../lib/api/testing.ts'
import { useSourceReloadOffer } from './use-source-reload-offer.ts'

interface Freshness {
  sourced: boolean
  revision: string | null
  syncing: boolean
}

/** A server whose answer the test changes, and the promise toasts the hook raised. */
function setUp(initial: Freshness) {
  let answer = initial
  let asked = 0
  const raised: {
    outcome: Promise<unknown>
    messages: ToastPromiseMessages<'updated' | 'current'>
  }[] = []
  vi.spyOn(toast, 'promise').mockImplementation((input, messages) => {
    raised.push({
      outcome: typeof input === 'function' ? input() : input,
      messages: messages as ToastPromiseMessages<'updated' | 'current'>,
    })
    return `toast-${raised.length}`
  })
  const wrapper = createHookWrapper({
    'GET /api/documents/{id}/source-freshness': () => {
      asked += 1
      return jsonResponse(200, answer)
    },
  })
  return {
    wrapper,
    raised,
    asked: () => asked,
    answer: (next: Freshness) => {
      answer = next
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** What the toast settled to: its title, and the label of its action. */
async function settled(entry: {
  outcome: Promise<unknown>
  messages: ToastPromiseMessages<'updated' | 'current'>
}) {
  const value = (await entry.outcome) as 'updated' | 'current'
  const success = entry.messages.success
  const message = typeof success === 'function' ? success(value) : success
  if (typeof message === 'object' && message !== null && 'title' in message) {
    const action = typeof message.action === 'function' ? message.action(value) : message.action
    return { title: message.title, action: action?.label, onClick: action?.onClick }
  }
  return { title: message, action: undefined, onClick: undefined }
}

function render(server: ReturnType<typeof setUp>, revision = 'r1') {
  return renderHook(
    () => useSourceReloadOffer({ documentId: 'd', sourced: true, readingHead: true, revision }),
    { wrapper: server.wrapper },
  )
}

/** The next poll: the hook asks again on its own interval. */
async function nextPoll(server: ReturnType<typeof setUp>) {
  const before = server.asked()
  await vi.advanceTimersByTimeAsync(SOURCE_FRESHNESS_REFRESH_MS)
  await waitFor(() => {
    expect(server.asked()).toBeGreaterThan(before)
  })
}

describe('useSourceReloadOffer', () => {
  it('asks nothing for a document that is not read from a repository', async () => {
    const server = setUp({ sourced: false, revision: 'r1', syncing: false })
    renderHook(
      () =>
        useSourceReloadOffer({
          documentId: 'd',
          sourced: false,
          readingHead: true,
          revision: 'r1',
        }),
      { wrapper: server.wrapper },
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.asked()).toBe(0)
  })

  it('shows the update under way, then offers a reload once the document has moved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const server = setUp({ sourced: true, revision: 'r1', syncing: true })
    render(server)
    await waitFor(() => {
      expect(server.raised).toHaveLength(1)
    })
    const first = server.raised[0]
    if (first === undefined) throw new Error('no toast')
    expect(first.messages.loading).toBe('Updating from the source repository')

    server.answer({ sourced: true, revision: 'r2', syncing: false })
    await nextPoll(server)
    const result = await settled(first)
    expect(result).toMatchObject({ title: 'Updated from the repository', action: 'Reload' })
    // Reloading is the reader's to ask for; pressing it refetches the document.
    result.onClick?.()
    expect(server.raised).toHaveLength(1)
  })

  it('settles to up to date when the sync ends and this document did not change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const server = setUp({ sourced: true, revision: 'r1', syncing: true })
    render(server)
    await waitFor(() => {
      expect(server.raised).toHaveLength(1)
    })
    server.answer({ sourced: true, revision: 'r1', syncing: false })
    await nextPoll(server)
    const first = server.raised[0]
    if (first === undefined) throw new Error('no toast')
    expect(await settled(first)).toMatchObject({ title: 'Already up to date', action: undefined })
  })

  it('offers a newer revision that landed unannounced, once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const server = setUp({ sourced: true, revision: 'r2', syncing: false })
    render(server)
    await waitFor(() => {
      expect(server.raised).toHaveLength(1)
    })
    const first = server.raised[0]
    if (first === undefined) throw new Error('no toast')
    expect(await settled(first)).toMatchObject({ title: 'Updated from the repository' })
    await nextPoll(server)
    expect(server.raised).toHaveLength(1)
  })

  it('offers nothing to a reader of an older revision or a comparison', async () => {
    const server = setUp({ sourced: true, revision: 'r2', syncing: true })
    renderHook(
      () =>
        useSourceReloadOffer({
          documentId: 'd',
          sourced: true,
          readingHead: false,
          revision: 'r1',
        }),
      { wrapper: server.wrapper },
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.asked()).toBe(0)
    expect(server.raised).toEqual([])
  })
})
