import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type * as ToneModule from './toast-tone.tsx'

// The sonner adapter (`sonner-toaster.tsx`) is the only module that calls
// `sonner`'s `toast` export; mocking it here lets these tests inspect exactly
// what crosses that seam — the `duration` a toast with an action is given, and
// the `id` a retried promise toast is given — without waiting on sonner's own
// timers or promise plumbing. `vi.mock` is hoisted above the imports below, so
// they see this mock rather than the real package.
type ToneMock = (title: unknown, options?: unknown) => string
const successMock = vi.fn<ToneMock>()
const infoMock = vi.fn<ToneMock>()
const warningMock = vi.fn<ToneMock>()
const errorMock = vi.fn<ToneMock>()
const messageMock = vi.fn<ToneMock>()
const promiseMock = vi.fn<(input: unknown, data: unknown) => string>()

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    success: successMock,
    info: infoMock,
    warning: warningMock,
    error: errorMock,
    message: messageMock,
    dismiss: vi.fn<(id?: unknown) => string>(),
    promise: promiseMock,
  },
}))

const announceMock = vi.fn<(message: string) => void>()

// The assertive announcement is `toast-tone.tsx`'s observer; spying on it here
// asserts what `danger` toasts hand it without mounting a live region.
vi.mock('./toast-tone.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof ToneModule>()),
  announceAssertively: announceMock,
}))

const { installToastSink, toast } = await import('./toast.ts')
const { sonnerSink } = await import('./sonner-toaster.tsx')

// `toast.ts` holds every call until a sink is installed — the toast host does
// that when it mounts (`toaster.tsx` loads it as a chunk of its own). These
// tests are about what reaches the library, so they install the real adapter
// directly and skip the host entirely.
installToastSink(sonnerSink)

describe('the toast sink', () => {
  it('replays what was raised before the host arrived, and holds nothing after it does', () => {
    const calls: string[] = []
    const uninstall = installToastSink({
      show: () => calls.push('show'),
      promise: () => calls.push('promise'),
      dismiss: () => calls.push('dismiss'),
    })

    toast.show({ title: 'Live' })
    expect(calls).toEqual(['show'])

    // Uninstalling a sink that is no longer the installed one changes nothing:
    // a second host has taken over, and the first one's teardown must not
    // leave the application with none.
    const second = { show: () => calls.push('second'), promise: () => {}, dismiss: () => {} }
    installToastSink(second)
    uninstall()
    toast.show({ title: 'Still live' })
    expect(calls).toEqual(['show', 'second'])

    installToastSink(sonnerSink)
  })

  it('takes a promise-returning function as well as a promise', () => {
    toast.promise(() => Promise.resolve('v4'), {
      loading: 'Syncing…',
      success: 'Synced',
      error: 'Sync failed',
    })

    const [input] = promiseMock.mock.calls.at(-1) as [unknown, unknown]
    expect(typeof input).toBe('function')
  })
})

describe('toast', () => {
  it('keeps a toast that carries an action from auto-dismissing', () => {
    toast.show({
      title: 'Comment deleted',
      action: { label: 'Undo', onClick: vi.fn<() => void>() },
    })

    const [, options] = messageMock.mock.calls.at(-1) as [unknown, { duration?: number }]
    expect(options.duration).toBe(Number.POSITIVE_INFINITY)
  })

  it('leaves duration as given when there is no action', () => {
    toast.show({ title: 'Draft renamed', duration: 2000 })

    const [, options] = messageMock.mock.calls.at(-1) as [unknown, { duration?: number }]
    expect(options.duration).toBe(2000)
  })

  it('resolves a promise outcome with one action to a persistent toast', () => {
    const onClick = vi.fn<() => void>()

    toast.promise(Promise.resolve('v4'), {
      loading: 'Syncing…',
      success: { title: 'Updated', action: { label: 'Reload', onClick } },
      error: 'Sync failed',
    })

    const [, data] = promiseMock.mock.calls.at(-1) as [
      unknown,
      { success: (value: string) => { action?: unknown; duration?: number } },
    ]
    const outcome = data.success('v4')

    expect(outcome.action).toEqual({ label: 'Reload', onClick })
    expect(outcome.duration).toBe(Number.POSITIVE_INFINITY)
  })

  it('resolves a promise outcome without an action to sonner’s own duration', () => {
    toast.promise(Promise.resolve('v4'), {
      loading: 'Syncing…',
      success: 'Updated',
      error: 'Sync failed',
    })

    const [, data] = promiseMock.mock.calls.at(-1) as [
      unknown,
      { success: (value: string) => { action?: unknown; duration?: number } },
    ]
    const outcome = data.success('v4')

    expect(outcome.action).toBeUndefined()
    expect(outcome.duration).toBeUndefined()
  })

  it('reuses a supplied id so a retry replaces the toast instead of stacking one', () => {
    const id = toast.promise(Promise.resolve(), {
      loading: 'Syncing…',
      success: 'Synced',
      error: 'Sync failed',
    })

    const retriedId = toast.promise(
      Promise.resolve(),
      { loading: 'Syncing…', success: 'Synced', error: 'Sync failed' },
      { id },
    )

    expect(retriedId).toBe(id)
    const [, data] = promiseMock.mock.calls.at(-1) as [unknown, { id: unknown }]
    expect(data.id).toBe(id)
  })

  it('generates a fresh id for each promise toast when none is supplied', () => {
    const first = toast.promise(Promise.resolve(), {
      loading: 'A',
      success: 'A done',
      error: 'A failed',
    })
    const second = toast.promise(Promise.resolve(), {
      loading: 'B',
      success: 'B done',
      error: 'B failed',
    })

    expect(first).not.toBe(second)
  })

  it('announces a danger toast with its description, in one sentence', () => {
    announceMock.mockClear()

    toast.danger('Disk is full', { description: 'Free 2 GB to keep saving' })

    expect(announceMock).toHaveBeenCalledTimes(1)
    expect(announceMock).toHaveBeenCalledWith(
      expect.stringContaining('Disk is full. Free 2 GB to keep saving'),
    )
  })

  it('announces a numeric title as text', () => {
    announceMock.mockClear()

    toast.danger(503)

    expect(announceMock).toHaveBeenCalledWith(expect.stringContaining('503'))
  })

  it('does not announce a title that has no plain-text form', () => {
    announceMock.mockClear()

    toast.danger(createElement('strong', null, 'Rich title'))

    expect(announceMock).not.toHaveBeenCalled()
  })

  it('resolves function-form promise messages with the settled value', () => {
    const onClick = vi.fn<() => void>()

    toast.promise(Promise.resolve(3), {
      loading: 'Counting…',
      success: (count) => ({
        title: (value) => `${value} of ${count} updated`,
        action: (value) => ({ label: `Open ${value}`, onClick }),
      }),
      error: 'Count failed',
    })

    const [, data] = promiseMock.mock.calls.at(-1) as [
      unknown,
      { success: (value: number) => { action?: { label: string } } },
    ]

    expect(data.success(3).action).toEqual({ label: 'Open 3', onClick })
  })

  it('announces a failed promise assertively only when its title is plain text', () => {
    announceMock.mockClear()

    toast.promise(Promise.reject(new Error('no')), {
      loading: 'Working…',
      success: 'Done',
      error: createElement('strong', null, 'Rich failure'),
    })
    const [, rich] = promiseMock.mock.calls.at(-1) as [unknown, { error: (r: unknown) => unknown }]
    rich.error(new Error('no'))
    expect(announceMock).not.toHaveBeenCalled()

    toast.promise(Promise.reject(new Error('no')), {
      loading: 'Working…',
      success: 'Done',
      error: 'Sync failed',
    })
    const [, plain] = promiseMock.mock.calls.at(-1) as [unknown, { error: (r: unknown) => unknown }]
    plain.error(new Error('no'))
    expect(announceMock).toHaveBeenCalledWith(expect.stringContaining('Sync failed'))
  })

  it('resolves a function-form message to a plain outcome when it returns one', () => {
    toast.promise(Promise.resolve('done'), {
      loading: 'Working…',
      success: (value) => ({ title: `Finished: ${value}` }),
      error: 'Failed',
    })

    const [, data] = promiseMock.mock.calls.at(-1) as [
      unknown,
      { success: (value: string) => { action?: unknown; duration?: number } },
    ]

    expect(data.success('done').action).toBeUndefined()
  })
})
