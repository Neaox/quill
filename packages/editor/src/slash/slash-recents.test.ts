import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RECENTS_KEY,
  RECENT_LIMIT,
  createSlashRecents,
  emojiRecentsKey,
} from './slash-recents.ts'

/** A `Storage` that refuses everything, as a blocked site's does. */
const REFUSING: Storage = {
  length: 0,
  clear: () => {},
  key: () => null,
  removeItem: () => {},
  getItem: () => {
    throw new Error('Access is denied')
  },
  setItem: () => {
    throw new Error('Quota exceeded')
  },
}

describe('recently used slash items', () => {
  it('remembers the most recent first, once each, up to the limit', () => {
    localStorage.clear()
    const recents = createSlashRecents('test.recent')
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) recents.remember(id)
    expect(recents.read()).toEqual(['b', 'f', 'e', 'd', 'c'])
    expect(recents.read()).toHaveLength(RECENT_LIMIT)
    expect(localStorage.getItem('test.recent')).toBe('["b","f","e","d","c"]')
  })

  it('keeps each person’s apart, under their own key', () => {
    localStorage.clear()
    createSlashRecents('editor.slash.recent.ada').remember('table')
    expect(createSlashRecents('editor.slash.recent.bo').read()).toEqual([])
    expect(createSlashRecents().read()).toEqual([])
    createSlashRecents().remember('quote')
    expect(localStorage.getItem(DEFAULT_RECENTS_KEY)).toBe('["quote"]')
  })

  it('keeps the emoji chosen last beside a person’s blocks, under a key of their own', () => {
    expect(emojiRecentsKey('editor.slash.recent.ada')).toBe('editor.slash.recent.ada.emoji')
    expect(emojiRecentsKey()).toBe(`${DEFAULT_RECENTS_KEY}.emoji`)
  })

  it('forgets rather than fails when storage is refused, missing, or holds nonsense', () => {
    const refused = createSlashRecents('test', REFUSING)
    expect(refused.read()).toEqual([])
    expect(() => {
      refused.remember('table')
    }).not.toThrow()

    const missing = createSlashRecents('test', null)
    missing.remember('table')
    expect(missing.read()).toEqual([])

    localStorage.clear()
    localStorage.setItem('broken', '{not json')
    expect(createSlashRecents('broken').read()).toEqual([])
    localStorage.setItem('object', '{"a":1}')
    expect(createSlashRecents('object').read()).toEqual([])
    localStorage.setItem('mixed', '["table",3,null,"quote"]')
    expect(createSlashRecents('mixed').read()).toEqual(['table', 'quote'])
  })

  it('reads no storage at all where touching it throws', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError')
      },
    })
    try {
      const recents = createSlashRecents('test')
      recents.remember('table')
      expect(recents.read()).toEqual([])
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  })
})
