import { describe, expect, it } from 'vitest'

import { commandForKey, presentReducer, stepFromSearch } from './present-state.ts'

const SEVEN = { index: 1, count: 7 }

describe('presentReducer', () => {
  it('steps forward and back', () => {
    expect(presentReducer(SEVEN, { type: 'next' })).toEqual({ index: 2, count: 7 })
    expect(presentReducer(SEVEN, { type: 'previous' })).toEqual({ index: 0, count: 7 })
  })

  it('jumps to the ends', () => {
    expect(presentReducer(SEVEN, { type: 'first' }).index).toBe(0)
    expect(presentReducer(SEVEN, { type: 'last' }).index).toBe(6)
  })

  it('goes to a named section', () => {
    expect(presentReducer(SEVEN, { type: 'go-to', index: 4 }).index).toBe(4)
  })

  it('does not wrap: a room does not go back to the title slide by accident', () => {
    const last = { index: 6, count: 7 }
    const first = { index: 0, count: 7 }

    expect(presentReducer(last, { type: 'next' })).toBe(last)
    expect(presentReducer(first, { type: 'previous' })).toBe(first)
  })

  it('returns the same state when nothing moved, so a caller can skip the navigation', () => {
    expect(presentReducer(SEVEN, { type: 'go-to', index: 1 })).toBe(SEVEN)
    expect(presentReducer(SEVEN, { type: 'go-to', index: 99 })).toEqual({ index: 6, count: 7 })
  })

  it('clamps a go-to that names a section this document does not have', () => {
    expect(presentReducer(SEVEN, { type: 'go-to', index: -3 }).index).toBe(0)
    expect(presentReducer(SEVEN, { type: 'go-to', index: 1.7 }).index).toBe(1)
  })

  it('has nowhere to go in a document with no steps', () => {
    const empty = { index: 0, count: 0 }

    expect(presentReducer(empty, { type: 'next' })).toBe(empty)
    expect(presentReducer(empty, { type: 'last' })).toBe(empty)
  })

  it('recovers from a position the document has outgrown', () => {
    expect(presentReducer({ index: 40, count: 3 }, { type: 'next' }).index).toBe(2)
    expect(presentReducer({ index: 40, count: 3 }, { type: 'previous' }).index).toBe(1)
  })
})

describe('stepFromSearch', () => {
  it('reads the one-based step in the URL as an index', () => {
    expect(stepFromSearch(3, 7)).toBe(2)
    expect(stepFromSearch(1, 7)).toBe(0)
  })

  it('opens at the beginning when the URL says nothing', () => {
    expect(stepFromSearch(undefined, 7)).toBe(0)
  })

  it('opens a link that has outlived its section rather than failing', () => {
    expect(stepFromSearch(99, 7)).toBe(6)
    expect(stepFromSearch(0, 7)).toBe(0)
    expect(stepFromSearch(Number.NaN, 7)).toBe(0)
  })
})

const stepOf = (key: string) => commandForKey({ key })

describe('commandForKey', () => {
  it('maps the keys a presentation remote and a keyboard send', () => {
    expect(stepOf('ArrowRight')).toEqual({ kind: 'step', event: { type: 'next' } })
    expect(stepOf('ArrowLeft')).toEqual({ kind: 'step', event: { type: 'previous' } })
    expect(stepOf('Home')).toEqual({ kind: 'step', event: { type: 'first' } })
    expect(stepOf('End')).toEqual({ kind: 'step', event: { type: 'last' } })
  })

  it.each([
    ['ArrowDown', 'forward', 'line'],
    ['ArrowUp', 'back', 'line'],
    ['PageDown', 'forward', 'page'],
    ['PageUp', 'back', 'page'],
    [' ', 'forward', 'page'],
  ] as const)(
    'takes %s as moving %s through a slide, which steps only when the slide has no more',
    (key, direction, distance) => {
      expect(commandForKey({ key })).toEqual({ kind: 'scroll', direction, distance, repeat: false })
    },
  )

  it('takes Shift+Space as Space backwards, as a browser does', () => {
    expect(commandForKey({ key: ' ', shiftKey: true })).toEqual({
      kind: 'scroll',
      direction: 'back',
      distance: 'page',
      repeat: false,
    })
  })

  it('maps the surface keys, in either case', () => {
    expect(commandForKey({ key: 'Escape' })).toEqual({ kind: 'exit' })
    expect(commandForKey({ key: 'g' })).toEqual({ kind: 'go-to' })
    expect(commandForKey({ key: 'G' })).toEqual({ kind: 'go-to' })
    expect(commandForKey({ key: 'n' })).toEqual({ kind: 'presenter' })
    expect(commandForKey({ key: 'p' })).toEqual({ kind: 'presenter' })
    expect(commandForKey({ key: 'N' })).toEqual({ kind: 'presenter' })
  })

  it('blanks the room’s screen with `b`, or the `.` that most clickers send for it', () => {
    expect(commandForKey({ key: 'b' })).toEqual({ kind: 'blank' })
    expect(commandForKey({ key: 'B' })).toEqual({ kind: 'blank' })
    expect(commandForKey({ key: '.' })).toEqual({ kind: 'blank' })
    expect(commandForKey({ key: 'b', ctrlKey: true })).toBeUndefined()
  })

  it('takes a held key that goes to a slide as one press, since a remote repeats its key while it is held', () => {
    expect(commandForKey({ key: 'ArrowRight', repeat: false })).toEqual({
      kind: 'step',
      event: { type: 'next' },
    })
    expect(commandForKey({ key: 'ArrowRight', repeat: true })).toBeUndefined()
    expect(commandForKey({ key: 'End', repeat: true })).toBeUndefined()
  })

  it('lets a held key that scrolls keep scrolling, and says it is held so it does not step', () => {
    expect(commandForKey({ key: 'PageDown', repeat: true })).toEqual({
      kind: 'scroll',
      direction: 'forward',
      distance: 'page',
      repeat: true,
    })
  })

  it('leaves the browser its own shortcuts', () => {
    expect(commandForKey({ key: 'ArrowLeft', metaKey: true })).toBeUndefined()
    expect(commandForKey({ key: 'Home', ctrlKey: true })).toBeUndefined()
    expect(commandForKey({ key: 'n', altKey: true })).toBeUndefined()
  })

  it('ignores everything it has no meaning for', () => {
    expect(commandForKey({ key: 'q' })).toBeUndefined()
    expect(commandForKey({ key: 'F5' })).toBeUndefined()
  })
})
