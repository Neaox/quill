import { describe, expect, it, vi } from 'vitest'

import { SLASH_ITEMS } from './slash-items.ts'
import { createSlashStore } from './slash-store.ts'

const OPEN = {
  query: 'tab',
  items: SLASH_ITEMS.slice(0, 1),
  rect: { top: 10, bottom: 20, left: 5 },
  apply: () => {},
}

describe('the bridge between the suggestion plugin and React', () => {
  it('starts closed', () => {
    expect(createSlashStore().getSnapshot().open).toBe(false)
  })

  it('tells its listeners when it opens and when it closes', () => {
    const store = createSlashStore()
    const listener = vi.fn<() => void>()
    const unsubscribe = store.subscribe(listener)

    store.open(OPEN)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toMatchObject({ open: true, query: 'tab' })

    store.close()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().open).toBe(false)

    unsubscribe()
    store.open(OPEN)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('says nothing when it is closed and is asked to close again', () => {
    const store = createSlashStore()
    const listener = vi.fn<() => void>()
    store.subscribe(listener)
    store.close()
    expect(listener).not.toHaveBeenCalled()
  })

  it('gives its keys to the menu only while the menu is shown', () => {
    const store = createSlashStore()
    const handler = vi.fn<(key: string) => boolean>(() => true)

    expect(store.handleKey('ArrowDown')).toBe(false)
    store.setKeyHandler(handler)
    expect(store.handleKey('ArrowDown')).toBe(false)

    store.open(OPEN)
    expect(store.handleKey('ArrowDown')).toBe(true)
    expect(handler).toHaveBeenCalledWith('ArrowDown')

    store.setKeyHandler(null)
    expect(store.handleKey('ArrowDown')).toBe(false)
  })

  it('does nothing when a closed snapshot is applied', () => {
    const store = createSlashStore()
    const item = SLASH_ITEMS[0]
    if (item === undefined) throw new Error('The catalogue is empty.')
    expect(() => {
      store.getSnapshot().apply(item)
    }).not.toThrow()
  })
})
