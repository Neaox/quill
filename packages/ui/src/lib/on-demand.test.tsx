import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { onDemand, useOnDemand, useOnDemandWhen, type OnDemand } from './on-demand.ts'

/** A module whose arrival the test decides. */
function controlled<T>(value: T) {
  const { promise, resolve } = Promise.withResolvers<T>()
  const importer = vi.fn<() => Promise<T>>(() => promise)
  return {
    importer,
    arrive: async () => {
      await act(async () => {
        resolve(value)
        await Promise.resolve()
      })
    },
  }
}

function Probe({ source }: { readonly source: OnDemand<{ readonly name: string }> }) {
  const module = useOnDemand(source)
  return <p>{module === undefined ? 'waiting' : module.name}</p>
}

afterEach(() => {
  vi.useRealTimers()
})

describe('onDemand', () => {
  it('imports once however many times it is asked, and then holds the module', async () => {
    const { importer, arrive } = controlled({ name: 'panel' })
    const source = onDemand(importer)

    const first = source.load()
    const second = source.load()
    expect(importer).toHaveBeenCalledTimes(1)
    expect(source.current()).toBeUndefined()

    await arrive()
    await expect(first).resolves.toEqual({ name: 'panel' })
    await expect(second).resolves.toEqual({ name: 'panel' })
    expect(source.current()).toEqual({ name: 'panel' })
  })

  it('tells its subscribers when the module arrives, and stops when they leave', async () => {
    const { importer, arrive } = controlled({ name: 'panel' })
    const source = onDemand(importer)
    const stays = vi.fn<() => void>()
    const leaves = vi.fn<() => void>()
    source.subscribe(stays)
    const unsubscribe = source.subscribe(leaves)
    unsubscribe()

    void source.load()
    await arrive()

    expect(stays).toHaveBeenCalledTimes(1)
    expect(leaves).not.toHaveBeenCalled()
  })

  it('forgets a failed import, so the next request tries again', async () => {
    const importer = vi
      .fn<() => Promise<{ readonly name: string }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ name: 'panel' })
    const source = onDemand(importer)

    await expect(source.load()).rejects.toThrow('offline')
    await expect(source.load()).resolves.toEqual({ name: 'panel' })
    expect(importer).toHaveBeenCalledTimes(2)
  })
})

describe('useOnDemand', () => {
  it('renders without the module, then again when it arrives', async () => {
    const { importer, arrive } = controlled({ name: 'panel' })
    const source = onDemand(importer)

    render(<Probe source={source} />)
    expect(screen.getByText('waiting')).toBeInTheDocument()

    void source.load()
    await arrive()
    expect(screen.getByText('panel')).toBeInTheDocument()
  })

  it('asks for the module in idle time, so it is there before anybody reaches for it', async () => {
    vi.useFakeTimers()
    const { importer } = controlled({ name: 'panel' })
    const source = onDemand(importer)

    render(<Probe source={source} />)
    expect(importer).not.toHaveBeenCalled()

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('renders with the module at once when it has already arrived', async () => {
    const source = onDemand(() => Promise.resolve({ name: 'panel' }))
    await source.load()

    render(<Probe source={source} />)
    expect(screen.getByText('panel')).toBeInTheDocument()
  })

  it('puts focus back on the control that replaced the focused one', async () => {
    const { importer, arrive } = controlled({ name: 'panel' })
    const source = onDemand(importer)

    function Control() {
      const module = useOnDemand(source)
      // A different element type, as a lazily upgraded control is: React
      // replaces the node rather than updating it.
      return module === undefined ? (
        <button type="button">Actions</button>
      ) : (
        <span>
          <button type="button">Actions</button>
        </span>
      )
    }

    render(
      <div>
        <Control />
      </div>,
    )
    screen.getByRole('button', { name: 'Actions' }).focus()

    void source.load()
    await arrive()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus()
  })
})

/** A light control that takes the module on only when engaged. */
function Instance({
  source,
  engaged = false,
}: {
  readonly source: OnDemand<{ readonly name: string }>
  readonly engaged?: boolean
}) {
  const [pressed, setPressed] = useState(false)
  const module = useOnDemandWhen(source, engaged || pressed)
  return module === undefined ? (
    <button
      type="button"
      onClick={() => {
        setPressed(true)
      }}
    >
      light
    </button>
  ) : (
    <span>{module.name}</span>
  )
}

describe('useOnDemandWhen', () => {
  it('leaves every unengaged instance alone when the module arrives', async () => {
    const { importer, arrive } = controlled({ name: 'heavy' })
    const source = onDemand(importer)
    render(
      <>
        {Array.from({ length: 200 }, (_, index) => (
          <Instance key={index} source={source} />
        ))}
      </>,
    )

    void source.load()
    await arrive()

    expect(screen.getAllByRole('button', { name: 'light' })).toHaveLength(200)
    expect(screen.queryByText('heavy')).not.toBeInTheDocument()
  })

  it('schedules one idle fetch however many instances ask', async () => {
    vi.useFakeTimers()
    const { importer } = controlled({ name: 'heavy' })
    const source = onDemand(importer)
    render(
      <>
        {Array.from({ length: 50 }, (_, index) => (
          <Instance key={index} source={source} />
        ))}
      </>,
    )

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('takes the module on for the engaged instance only, and keeps it', async () => {
    const source = onDemand(() => Promise.resolve({ name: 'heavy' }))
    await source.load()
    const { rerender } = render(
      <>
        <Instance source={source} engaged />
        <Instance source={source} />
      </>,
    )
    expect(screen.getAllByText('heavy')).toHaveLength(1)

    rerender(
      <>
        <Instance source={source} engaged={false} />
        <Instance source={source} />
      </>,
    )
    expect(screen.getAllByText('heavy')).toHaveLength(1)

    act(() => {
      screen.getByRole('button', { name: 'light' }).click()
    })
    expect(screen.getAllByText('heavy')).toHaveLength(2)
  })
})
