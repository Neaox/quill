import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyLiveMessage,
  isLive,
  LIVE_BACKSTOP_MS,
  useIsLive,
  useWorkspaceLive,
  whileLive,
} from './live.ts'
import { queryKeys } from './query-keys.ts'

/** Stands in for the browser's `EventSource`, which jsdom does not have. */
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static last: FakeEventSource | null = null
  readonly url: string
  readyState = FakeEventSource.CONNECTING
  closed = false

  constructor(url: string) {
    super()
    this.url = url
    FakeEventSource.last = this
  }

  close(): void {
    this.closed = true
    this.readyState = FakeEventSource.CLOSED
  }

  emit(name: string, data?: unknown): void {
    if (name === 'open') this.readyState = FakeEventSource.OPEN
    const event =
      data === undefined
        ? new Event(name)
        : new MessageEvent(name, { data: typeof data === 'string' ? data : JSON.stringify(data) })
    act(() => {
      this.dispatchEvent(event)
    })
  }
}

const WORKSPACE = 'ws-1'

function setUp() {
  const queryClient = new QueryClient()
  const invalidated = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const keys = () => invalidated.mock.calls.map(([filters]) => filters?.queryKey)
  return { queryClient, wrapper, keys, invalidated }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.last = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a workspace’s live stream', () => {
  it('opens one stream for the workspace, and says whether it is open', () => {
    const { wrapper } = setUp()
    const live = renderHook(() => useIsLive(WORKSPACE), { wrapper })
    const stream = renderHook(() => useWorkspaceLive(WORKSPACE, true), { wrapper })
    const source = FakeEventSource.last
    expect(source?.url).toBe('/api/workspaces/ws-1/events')
    expect(live.result.current).toBe(false)

    source?.emit('open')
    expect(live.result.current).toBe(true)
    // Reconnecting: the polling hooks take over until it is back.
    source?.emit('error')
    expect(isLive(WORKSPACE)).toBe(false)

    stream.unmount()
    expect(source?.closed).toBe(true)
  })

  it('reads again what changed while the stream was down, once it is back', () => {
    const { wrapper, keys } = setUp()
    renderHook(() => useWorkspaceLive(WORKSPACE, true), { wrapper })
    const source = FakeEventSource.last
    source?.emit('open')
    expect(keys()).toEqual([])
    source?.emit('error')
    source?.emit('open')
    expect(keys()).toContainEqual(queryKeys.workspaceTree(WORKSPACE))
  })

  it('stops for good when the server refuses the stream', () => {
    const { wrapper } = setUp()
    renderHook(() => useWorkspaceLive(WORKSPACE, true), { wrapper })
    const source = FakeEventSource.last
    if (source !== null) source.readyState = FakeEventSource.CLOSED
    source?.emit('error')
    expect(isLive(WORKSPACE)).toBe(false)
  })

  it('marks stale what each message is about', () => {
    const { wrapper, keys, invalidated } = setUp()
    renderHook(() => useWorkspaceLive(WORKSPACE, true), { wrapper })
    const source = FakeEventSource.last

    source?.emit('sync', { state: 'started', changed: false })
    expect(keys()).toEqual([queryKeys.workspaceSource(WORKSPACE), queryKeys.sourceFreshnessAll()])

    invalidated.mockClear()
    source?.emit('sync', { state: 'finished', changed: true })
    expect(keys()).toEqual([
      queryKeys.workspaceSource(WORKSPACE),
      queryKeys.sourceFreshnessAll(),
      queryKeys.workspaceTree(WORKSPACE),
      queryKeys.workspaceDocuments(WORKSPACE),
    ])

    invalidated.mockClear()
    source?.emit('document', { documentId: 'doc-1', revision: 'r2' })
    expect(keys()).toEqual([queryKeys.sourceFreshnessAll()])

    invalidated.mockClear()
    source?.emit('tree', {})
    expect(keys()).toEqual([
      queryKeys.workspaceTree(WORKSPACE),
      queryKeys.workspaceDocuments(WORKSPACE),
    ])

    invalidated.mockClear()
    source?.emit('reset', 'not json')
    source?.emit('tree', 'null')
    expect(keys()).toHaveLength(6)
  })

  it('ignores a message it does not know', () => {
    const { queryClient, invalidated } = setUp()
    applyLiveMessage(queryClient, WORKSPACE, 'weather', {})
    expect(invalidated).not.toHaveBeenCalled()
  })

  it('opens nothing for a workspace with nothing to stream, or a browser without streams', () => {
    const { wrapper } = setUp()
    renderHook(() => useWorkspaceLive(WORKSPACE, false), { wrapper })
    expect(FakeEventSource.last).toBeNull()
    vi.stubGlobal('EventSource', undefined)
    renderHook(() => useWorkspaceLive(WORKSPACE, true), { wrapper })
    expect(FakeEventSource.last).toBeNull()
  })

  it('slows polling to a backstop while the stream is open, and keeps it otherwise', () => {
    const { wrapper } = setUp()
    expect(whileLive(WORKSPACE, 3_000, LIVE_BACKSTOP_MS)).toBe(3_000)
    expect(whileLive(undefined, 3_000, LIVE_BACKSTOP_MS)).toBe(3_000)
    expect(whileLive(WORKSPACE, false, LIVE_BACKSTOP_MS)).toBe(false)
    renderHook(() => useWorkspaceLive(WORKSPACE, true), { wrapper })
    FakeEventSource.last?.emit('open')
    expect(whileLive(WORKSPACE, 3_000, LIVE_BACKSTOP_MS)).toBe(LIVE_BACKSTOP_MS)
  })
})
