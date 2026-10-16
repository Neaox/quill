import { describe, expect, it, vi } from 'vitest'

import { createFetchObserver } from './fetch-log.ts'
import type { FetchLogSink } from './fetch-log.ts'

const EVENT = {
  host: 'blog.example',
  purpose: 'page' as const,
  outcome: 'ok',
  status: 200,
  redirects: 1,
  bytes: 4096,
  durationMs: 120,
}

describe('createFetchObserver', () => {
  it('writes one line per fetch with the host and how it went', () => {
    const info = vi.fn<FetchLogSink['info']>()
    createFetchObserver(() => ({ info }))(EVENT)
    expect(info).toHaveBeenCalledExactlyOnceWith(
      {
        host: 'blog.example',
        purpose: 'page',
        outcome: 'ok',
        status: 200,
        redirects: 1,
        bytes: 4096,
        durationMs: 120,
      },
      'link preview fetch',
    )
  })

  it('drops the event while there is no logger yet', () => {
    expect(() => createFetchObserver(() => undefined)(EVENT)).not.toThrow()
  })

  it('looks the logger up when the event arrives, not when the observer was made', () => {
    const info = vi.fn<FetchLogSink['info']>()
    let sink: FetchLogSink | undefined
    const observer = createFetchObserver(() => sink)
    observer(EVENT)
    sink = { info }
    observer(EVENT)
    expect(info).toHaveBeenCalledOnce()
  })

  it('carries nothing but the host of the address: no path, query or response', () => {
    const info = vi.fn<FetchLogSink['info']>()
    createFetchObserver(() => ({ info }))(EVENT)
    const logged = JSON.stringify(info.mock.calls)
    expect(logged).not.toContain('token')
    expect(Object.keys(info.mock.calls[0]?.[0] ?? {}).toSorted()).toEqual([
      'bytes',
      'durationMs',
      'host',
      'outcome',
      'purpose',
      'redirects',
      'status',
    ])
  })
})
