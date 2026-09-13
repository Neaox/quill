import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useFullscreen } from './use-fullscreen.ts'

/**
 * jsdom has no Fullscreen API, so the three pieces the hook touches are
 * installed per test: the element that is full screen, the request, and the
 * exit. Each one drives `fullscreenchange` the way a browser does, which is
 * what the hook actually reads.
 */
function fireChange(): void {
  globalThis.document.dispatchEvent(new Event('fullscreenchange'))
}

function define(target: object, name: string, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, name, { configurable: true, ...descriptor })
}

function installFullscreen() {
  let element: Element | null = null

  const leaveFromTheBrowser = (): void => {
    element = null
    fireChange()
  }

  const requestFullscreen = vi.fn<() => Promise<void>>(async () => {
    element = globalThis.document.documentElement
    fireChange()
  })
  const exitFullscreen = vi.fn<() => Promise<void>>(async () => {
    leaveFromTheBrowser()
  })

  define(globalThis.document, 'fullscreenElement', { get: () => element })
  define(globalThis.document, 'exitFullscreen', { value: exitFullscreen })
  define(globalThis.document.documentElement, 'requestFullscreen', { value: requestFullscreen })

  return {
    requestFullscreen,
    exitFullscreen,
    /** The browser's own exit: Escape or F11, which nothing on the page asked for. */
    leaveFromTheBrowser,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useFullscreen', () => {
  it('asks for the screen when the surface opens and gives it back when it closes', async () => {
    const api = installFullscreen()
    const { result, unmount } = renderHook(() => useFullscreen())

    await waitFor(() => {
      expect(result.current.active).toBe(true)
    })
    expect(api.requestFullscreen).toHaveBeenCalled()

    unmount()

    await waitFor(() => {
      expect(api.exitFullscreen).toHaveBeenCalled()
    })
  })

  it('reports an exit the surface did not ask for, which is how Escape is heard at all', async () => {
    const api = installFullscreen()
    const onBrowserExit = vi.fn<() => void>()
    const { result } = renderHook(() => useFullscreen({ onBrowserExit }))

    await waitFor(() => {
      expect(result.current.active).toBe(true)
    })

    // Firefox and WebKit never dispatch this Escape to the page; the exit is
    // the only thing they report, and it has to be enough.
    act(() => {
      api.leaveFromTheBrowser()
    })

    expect(result.current.active).toBe(false)
    await waitFor(() => {
      expect(onBrowserExit).toHaveBeenCalledTimes(1)
    })
  })

  it('stays quiet when the surface’s own control leaves full screen', async () => {
    installFullscreen()
    const onBrowserExit = vi.fn<() => void>()
    const { result } = renderHook(() => useFullscreen({ onBrowserExit }))

    await waitFor(() => {
      expect(result.current.active).toBe(true)
    })

    act(() => {
      result.current.exit()
    })

    await waitFor(() => {
      expect(result.current.active).toBe(false)
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(onBrowserExit).not.toHaveBeenCalled()
  })

  it('reads a burst of changes as what it ends on, not as each of its steps', async () => {
    const api = installFullscreen()
    const onBrowserExit = vi.fn<() => void>()
    const { result } = renderHook(() => useFullscreen({ onBrowserExit }))

    await waitFor(() => {
      expect(result.current.active).toBe(true)
    })

    // WebKit's delivery: an exit, the same exit again, and the re-entry that
    // React's development double-mount asked for, all inside a few frames.
    act(() => {
      api.leaveFromTheBrowser()
      api.leaveFromTheBrowser()
    })
    await act(async () => {
      await api.requestFullscreen()
    })

    await waitFor(() => {
      expect(result.current.active).toBe(true)
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(onBrowserExit).not.toHaveBeenCalled()
  })

  it('does not call a refusal an exit', async () => {
    const api = installFullscreen()
    // What WebKit does with a request that carries no user gesture: it
    // refuses, and still reports a change whose `fullscreenElement` is null.
    api.requestFullscreen.mockImplementation(async () => {
      api.leaveFromTheBrowser()
      throw new Error('Fullscreen request denied')
    })
    const onBrowserExit = vi.fn<() => void>()
    const { result } = renderHook(() => useFullscreen({ onBrowserExit }))

    await waitFor(() => {
      expect(api.requestFullscreen).toHaveBeenCalled()
    })

    expect(result.current.active).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(onBrowserExit).not.toHaveBeenCalled()
  })

  it('offers nothing where the browser has no full screen at all', () => {
    define(globalThis.document, 'exitFullscreen', { value: undefined })
    const { result } = renderHook(() => useFullscreen())

    expect(result.current.supported).toBe(false)
    expect(result.current.active).toBe(false)
  })
})
