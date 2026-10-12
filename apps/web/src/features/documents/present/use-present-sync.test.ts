import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BroadcastLike, ChannelFactory } from './present-channel.ts'
import type { SlideEntry } from './present-state.ts'
import { usePresentSync, type PresentSyncOptions } from './use-present-sync.ts'

/** Every channel made by this factory hears the others of the same name, as `BroadcastChannel`s do. */
function aBus(): ChannelFactory {
  const channels = new Map<string, Set<FakeChannel>>()
  class FakeChannel implements BroadcastLike {
    readonly listeners = new Set<(event: MessageEvent<unknown>) => void>()
    readonly name: string
    constructor(name: string) {
      this.name = name
      channels.set(name, (channels.get(name) ?? new Set()).add(this))
    }
    postMessage(message: unknown): void {
      for (const other of channels.get(this.name) ?? []) {
        if (other === this) continue
        for (const listener of other.listeners) listener({ data: message } as MessageEvent<unknown>)
      }
    }
    addEventListener(_: 'message', listener: (event: MessageEvent<unknown>) => void): void {
      this.listeners.add(listener)
    }
    removeEventListener(_: 'message', listener: (event: MessageEvent<unknown>) => void): void {
      this.listeners.delete(listener)
    }
    close(): void {
      channels.get(this.name)?.delete(this)
    }
  }
  return (name) => new FakeChannel(name)
}

function aWindow(
  bus: ChannelFactory,
  options: Partial<PresentSyncOptions> & Pick<PresentSyncOptions, 'role'>,
) {
  const onFollow = vi.fn<(index: number, entry: SlideEntry) => void>()
  const onClosePresenter = vi.fn<() => void>()
  const onBlank = vi.fn<(blank: boolean) => void>()
  const onDetails = vi.fn<(step: number, open: readonly boolean[]) => void>()
  const view = renderHook(
    (props: Partial<PresentSyncOptions>) =>
      usePresentSync({
        documentId: 'doc-1',
        revision: 'r1',
        index: 0,
        blank: false,
        onFollow,
        onBlank,
        onDetails,
        openedDetails: () => new Map(),
        onClosePresenter,
        channelFactory: bus,
        ...options,
        ...props,
      }),
    { initialProps: {} },
  )
  return { ...view, onFollow, onBlank, onDetails, onClosePresenter }
}

describe('two windows of one presentation', () => {
  it('is alone until the other window opens, then knows it is following', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience' })
    expect(audience.result.current.peer).toBe('alone')

    const presenter = aWindow(bus, { role: 'presenter' })

    expect(audience.result.current.peer).toBe('following')
    expect(presenter.result.current.peer).toBe('following')
  })

  it('takes a window that opens late to the step the room is on', () => {
    const bus = aBus()
    aWindow(bus, { role: 'audience', index: 4 })
    const presenter = aWindow(bus, { role: 'presenter', index: 0 })

    expect(presenter.onFollow).toHaveBeenCalledWith(4, 'top')
  })

  it('carries a step from one window to the other, and only the other', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience' })
    const presenter = aWindow(bus, { role: 'presenter' })

    act(() => {
      presenter.result.current.announce(3)
    })

    expect(audience.onFollow).toHaveBeenCalledWith(3, 'top')
    expect(presenter.onFollow).not.toHaveBeenCalled()
  })

  it('says which end of the slide the other window arrived at, so scrolling back lands at the foot', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience' })
    const presenter = aWindow(bus, { role: 'presenter' })

    act(() => {
      presenter.result.current.announce(1, 'bottom')
    })

    expect(audience.onFollow).toHaveBeenCalledWith(1, 'bottom')
  })

  it('does not answer a step with the step it was told, so the two cannot echo each other', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience', index: 2 })
    const presenter = aWindow(bus, { role: 'presenter', index: 2 })
    audience.onFollow.mockClear()
    presenter.onFollow.mockClear()

    act(() => {
      audience.result.current.announce(2)
    })

    expect(presenter.onFollow).not.toHaveBeenCalled()
  })

  it('carries a section being opened or folded to the other window, and only the other', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience' })
    const presenter = aWindow(bus, { role: 'presenter' })

    act(() => {
      presenter.result.current.announceDetails(2, [false, true])
    })

    expect(audience.onDetails).toHaveBeenCalledWith(2, [false, true])
    expect(presenter.onDetails).not.toHaveBeenCalled()
  })

  it('tells a window that opens late which sections the room has opened', () => {
    const bus = aBus()
    aWindow(bus, {
      role: 'audience',
      openedDetails: () =>
        new Map([
          [2, [false, true]],
          [5, [true]],
        ]),
    })
    const presenter = aWindow(bus, { role: 'presenter' })

    expect(presenter.onDetails.mock.calls).toEqual([
      [2, [false, true]],
      [5, [true]],
    ])
  })

  it('does not open a section in a window that is showing another version of the document', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience', revision: 'r1' })
    const presenter = aWindow(bus, { role: 'presenter', revision: 'r2' })

    act(() => {
      presenter.result.current.announceDetails(0, [true])
    })

    expect(audience.onDetails).not.toHaveBeenCalled()
  })

  it('says so when the other window is showing another version of the document', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience', revision: 'r1' })
    const presenter = aWindow(bus, { role: 'presenter', revision: 'r2' })

    expect(audience.result.current.peer).toBe('other-revision')
    expect(presenter.result.current.peer).toBe('other-revision')
    act(() => {
      presenter.result.current.announce(5)
    })
    expect(audience.onFollow).not.toHaveBeenCalledWith(5)
  })

  it('hands out the same thing on every render while nothing about the pairing changed', () => {
    const window = aWindow(aBus(), { role: 'audience' })
    const first = window.result.current

    window.rerender({})
    window.rerender({})

    // What the keyboard depends on must not change under a key press that causes a render.
    expect(window.result.current).toBe(first)
    expect(window.result.current.announce).toBe(first.announce)
  })

  it('carries a black screen from one window to the other, and back', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience' })
    const presenter = aWindow(bus, { role: 'presenter' })

    act(() => {
      presenter.result.current.announceBlank(true)
    })
    expect(audience.onBlank).toHaveBeenLastCalledWith(true)
    expect(presenter.onBlank).not.toHaveBeenCalled()

    act(() => {
      audience.result.current.announceBlank(false)
    })
    expect(presenter.onBlank).toHaveBeenLastCalledWith(false)
  })

  it('tells a window that opens late that the room’s screen is black', () => {
    const bus = aBus()
    aWindow(bus, { role: 'audience', blank: true })
    const presenter = aWindow(bus, { role: 'presenter' })

    expect(presenter.onBlank).toHaveBeenCalledWith(true)
  })

  it('is alone again when the other window closes', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience' })
    const presenter = aWindow(bus, { role: 'presenter' })

    presenter.unmount()

    expect(audience.result.current.peer).toBe('alone')
  })

  it('lets the audience window ask the presenter window to close', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience' })
    const presenter = aWindow(bus, { role: 'presenter' })

    act(() => {
      audience.result.current.closePresenter()
    })

    expect(presenter.onClosePresenter).toHaveBeenCalledTimes(1)
    expect(audience.onClosePresenter).not.toHaveBeenCalled()
  })

  it('does not hear a presentation of another document', () => {
    const bus = aBus()
    const audience = aWindow(bus, { role: 'audience', documentId: 'doc-1' })
    const other = aWindow(bus, { role: 'presenter', documentId: 'doc-2' })

    act(() => {
      other.result.current.announce(3)
    })

    expect(audience.onFollow).not.toHaveBeenCalled()
    expect(audience.result.current.peer).toBe('alone')
  })
})
