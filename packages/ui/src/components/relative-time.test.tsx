import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { expectNoAccessibilityViolations } from '../../testing/axe.ts'
import { LocalTime } from './local-time.tsx'
import { RelativeTime } from './relative-time.tsx'

const NOW = new Date('2026-10-12T12:00:00.000Z')
const AT = '2026-10-12T12:00:00.000Z'
const minutesAgo = (minutes: number): string =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString()

/** What the platform says for a moment: what is asserted is that it was asked, not a time zone's guess. */
const said = (locale: string, options: Intl.DateTimeFormatOptions, at: string): string =>
  new Intl.DateTimeFormat(locale, options).format(new Date(at))

const FULL: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'long' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RelativeTime', () => {
  it('says how long ago, as a time element that carries the moment and shows it in full when hovered', () => {
    render(<RelativeTime value={minutesAgo(2)} locale="en-GB" />)

    const time = screen.getByText('2 minutes ago')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', minutesAgo(2))
    expect(time).toHaveAttribute('title', said('en-GB', FULL, minutesAgo(2)))
  })

  it('says it in the language it is asked for, which is the reader’s own by default', () => {
    render(<RelativeTime value={minutesAgo(2)} locale="fr" />)

    expect(screen.getByText('il y a 2 minutes')).toHaveAttribute(
      'title',
      said('fr', FULL, minutesAgo(2)),
    )
  })

  it('says "just now" under a minute', () => {
    render(<RelativeTime value={NOW} locale="en" />)

    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('stays true as time passes, without being asked', () => {
    render(<RelativeTime value={NOW} locale="en" />)
    expect(screen.getByText('just now')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(46_000)
    })
    expect(screen.getByText('1 minute ago')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(90_000)
    })
    expect(screen.getByText('2 minutes ago')).toBeInTheDocument()
  })

  it('keeps a thousand of them up to date with one timer, and wakes only those that changed', () => {
    const renders = vi.fn<(id: number) => void>()
    function Counted({ id, at }: { readonly id: number; readonly at: string }) {
      renders(id)
      return <RelativeTime value={at} locale="en" />
    }
    render(
      <>
        {Array.from({ length: 1000 }, (_, n) => (
          <Counted key={n} id={n} at={n < 500 ? minutesAgo(1) : minutesAgo(180)} />
        ))}
      </>,
    )

    expect(vi.getTimerCount()).toBe(1)
    const before = renders.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(31_000)
    })

    // Those a minute old became "2 minutes ago"; those three hours old did not move.
    expect(screen.getAllByText('2 minutes ago')).toHaveLength(500)
    expect(screen.getAllByText('3 hours ago')).toHaveLength(500)
    expect(vi.getTimerCount()).toBe(1)
    // A time re-renders itself, not its parent: nothing above it was drawn again.
    expect(renders.mock.calls.length).toBe(before)
  })

  it('sets no timer when it is not live, and says what it said when drawn', () => {
    render(<RelativeTime value={NOW} live={false} locale="en" />)

    expect(vi.getTimerCount()).toBe(0)
    act(() => {
      vi.advanceTimersByTime(600_000)
    })
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('lets go of its timer when it goes', () => {
    const { unmount } = render(<RelativeTime value={NOW} />)
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('draws nothing for a moment that is not one', () => {
    const { container } = render(<RelativeTime value="not a date" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('has no accessibility violations', async () => {
    // axe waits on timers, which are the test's while they are faked.
    vi.useRealTimers()
    const { container } = render(<RelativeTime value={minutesAgo(5)} />)

    await expectNoAccessibilityViolations(container)
  })
})

describe('LocalTime', () => {
  it('writes a date in the reader’s language, as a time element, and in full when hovered', () => {
    render(<LocalTime value={AT} format="month-day" locale="en-GB" />)

    const time = screen.getByText(said('en-GB', { day: 'numeric', month: 'short' }, AT))
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', AT)
    expect(time).toHaveAttribute('title', said('en-GB', FULL, AT))
  })

  it('writes it in the language it is asked for', () => {
    render(<LocalTime value={AT} format="date" locale="de" />)

    expect(screen.getByRole('time')).toHaveTextContent(said('de', { dateStyle: 'medium' }, AT))
  })

  it('can say a date and a time', () => {
    render(<LocalTime value={AT} format="datetime" locale="en-GB" />)

    expect(screen.getByRole('time')).toHaveTextContent(
      said('en-GB', { dateStyle: 'medium', timeStyle: 'short' }, AT),
    )
  })

  it('draws nothing for a moment that is not one', () => {
    const { container } = render(<LocalTime value="nope" />)

    expect(container).toBeEmptyDOMElement()
  })
})
