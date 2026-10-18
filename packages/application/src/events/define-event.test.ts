import { describe, expect, it } from 'vitest'

import { defineEvent } from './define-event.ts'

interface Greeted {
  readonly version: number
  readonly name: string
}

const greeted = defineEvent<Greeted>('Greeted', {
  1: (payload) => {
    const name = (payload as { name?: unknown }).name
    return typeof name === 'string' && name.length > 0 ? { version: 1, name } : null
  },
})

describe('defineEvent', () => {
  it('names the event and the version this release writes', () => {
    expect(greeted.type).toBe('Greeted')
    expect(greeted.version).toBe(1)
  })

  it('reads a payload of a version it knows', () => {
    expect(greeted.parse({ version: 1, name: 'Ada' })).toEqual({ version: 1, name: 'Ada' })
  })

  it('refuses what it cannot read rather than guessing', () => {
    expect(greeted.parse(null)).toBeNull()
    expect(greeted.parse({ version: 1, name: '' })).toBeNull()
    expect(greeted.parse({ version: 2, name: 'Ada' })).toBeNull()
  })

  it('is announced to the bus unless it says it carries something the bus must not see', () => {
    expect(greeted.announced).toBe(true)
    const quiet = defineEvent<Greeted>('Quiet', { 1: () => null }, { announced: false })
    expect(quiet.announced).toBe(false)
  })

  it('writes the highest version it has a reader for, and still reads the older ones', () => {
    const renamed = defineEvent<{ readonly version: number; readonly title: string }>('Titled', {
      1: (payload) => ({ version: 1, title: String((payload as { name?: unknown }).name) }),
      2: (payload) => ({ version: 2, title: String((payload as { title?: unknown }).title) }),
    })
    expect(renamed.version).toBe(2)
    expect(renamed.parse({ version: 1, name: 'old' })).toEqual({ version: 1, title: 'old' })
    expect(renamed.parse({ version: 2, title: 'new' })).toEqual({ version: 2, title: 'new' })
  })
})
