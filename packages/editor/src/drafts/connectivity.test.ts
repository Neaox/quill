import { afterEach, describe, expect, it, vi } from 'vitest'

import { browserConnectivity, createFakeConnectivity } from './connectivity.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('browserConnectivity', () => {
  it('reads the browser’s own answers', () => {
    expect(browserConnectivity.isOnline()).toBe(navigator.onLine)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    expect(browserConnectivity.isVisible()).toBe(false)
  })

  it('hears online, offline and visibility changes until unsubscribed', () => {
    const heard: string[] = []
    const unsubscribe = browserConnectivity.subscribe(() => {
      heard.push('change')
    })

    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(heard).toHaveLength(3)

    unsubscribe()
    window.dispatchEvent(new Event('online'))
    expect(heard).toHaveLength(3)
  })
})

describe('createFakeConnectivity', () => {
  it('tells its listeners, and stops when they leave', () => {
    const connectivity = createFakeConnectivity()
    let heard = 0
    const unsubscribe = connectivity.subscribe(() => {
      heard += 1
    })

    connectivity.setOnline(false)
    connectivity.setVisible(false)
    expect([connectivity.isOnline(), connectivity.isVisible(), heard]).toEqual([false, false, 2])

    unsubscribe()
    connectivity.setOnline(true)
    expect(heard).toBe(2)
  })
})
