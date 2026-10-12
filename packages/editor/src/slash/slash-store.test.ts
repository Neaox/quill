import { describe, expect, it, vi } from 'vitest'

import type { SlashPicker } from './slash-item.ts'
import { createSlashStore } from './slash-store.ts'

const MENU = {
  query: 'tab',
  sections: [],
  rect: { top: 10, bottom: 20, left: 5 },
  apply: () => {},
}

const PICKER: SlashPicker = {
  title: 'Badge tone',
  placeholder: 'Search tones',
  empty: () => 'Nothing',
  source: { kind: 'list', options: () => [] },
  choose: () => () => true,
}

const PICKING = { picker: PICKER, rect: null, choose: () => {}, cancel: () => {} }

describe('the bridge between the suggestion plugin and React', () => {
  it('starts closed', () => {
    expect(createSlashStore().getSnapshot().mode).toBe('closed')
  })

  it('tells its listeners when the menu opens and when it closes', () => {
    const store = createSlashStore()
    const listener = vi.fn<() => void>()
    const unsubscribe = store.subscribe(listener)

    store.showMenu(MENU)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toMatchObject({ mode: 'menu', query: 'tab' })

    store.close()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().mode).toBe('closed')

    unsubscribe()
    store.showMenu(MENU)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('says nothing when it is closed and is asked to close again', () => {
    const store = createSlashStore()
    const listener = vi.fn<() => void>()
    store.subscribe(listener)
    store.close()
    store.closeMenu()
    expect(listener).not.toHaveBeenCalled()
  })

  it('leaves a picker open when the menu that opened it closes', () => {
    const store = createSlashStore()
    store.showPicker(PICKING)
    store.closeMenu()
    expect(store.getSnapshot().mode).toBe('picker')
    store.close()
    expect(store.getSnapshot().mode).toBe('closed')

    store.showMenu(MENU)
    store.closeMenu()
    expect(store.getSnapshot().mode).toBe('closed')
  })

  it('gives its keys to the menu only while the menu is shown', () => {
    const store = createSlashStore()
    const handler = vi.fn<(key: string) => boolean>(() => true)

    expect(store.handleKey('ArrowDown')).toBe(false)
    store.setKeyHandler(handler)
    expect(store.handleKey('ArrowDown')).toBe(false)

    store.showPicker(PICKING)
    expect(store.handleKey('ArrowDown')).toBe(false)

    store.showMenu(MENU)
    expect(store.handleKey('ArrowDown')).toBe(true)
    expect(handler).toHaveBeenCalledWith('ArrowDown')

    store.setKeyHandler(null)
    expect(store.handleKey('ArrowDown')).toBe(false)
  })
})
