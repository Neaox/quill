import { describe, expect, it } from 'vitest'

import { barCommandFor } from './find-keys.ts'
import type { BarKeyEvent } from './find-keys.ts'

const press = (key: string, extra: Partial<BarKeyEvent> = {}): BarKeyEvent => ({
  key,
  code: `Key${key.toUpperCase()}`,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...extra,
})

describe('the keys of the find bar', () => {
  it('steps with Enter in the find field, and back with Shift+Enter', () => {
    expect(barCommandFor(press('Enter'), 'find')).toBe('next')
    expect(barCommandFor(press('Enter', { shiftKey: true }), 'find')).toBe('previous')
  })

  it('replaces with Enter in the replace field, and everything with Ctrl or Command and Alt', () => {
    expect(barCommandFor(press('Enter'), 'replace')).toBe('replace')
    expect(barCommandFor(press('Enter', { ctrlKey: true, altKey: true }), 'replace')).toBe(
      'replace-all',
    )
    expect(barCommandFor(press('Enter', { metaKey: true, altKey: true }), 'replace')).toBe(
      'replace-all',
    )
  })

  it('closes on Escape, from either field', () => {
    expect(barCommandFor(press('Escape'), 'find')).toBe('close')
    expect(barCommandFor(press('Escape'), 'replace')).toBe('close')
  })

  it('toggles the options with Alt and a letter, by the key’s place so it works where Alt makes another letter', () => {
    expect(barCommandFor(press('c', { altKey: true }), 'find')).toBe('toggle-case')
    expect(barCommandFor(press('w', { altKey: true }), 'find')).toBe('toggle-word')
    expect(barCommandFor(press('r', { altKey: true }), 'find')).toBe('toggle-regex')
    expect(barCommandFor(press('p', { altKey: true }), 'replace')).toBe('toggle-preserve-case')
    expect(barCommandFor(press('l', { altKey: true }), 'find')).toBe('toggle-selection')
    expect(barCommandFor({ ...press('ç', { altKey: true }), code: 'KeyC' }, 'find')).toBe(
      'toggle-case',
    )
  })

  it('takes Ctrl or Command with F back to the find field, and with H (or Alt and F) to the replace field', () => {
    const chord = (code: string, extra: Partial<BarKeyEvent> = {}) =>
      ({ ...press(code.at(-1) ?? ''), code, ...extra }) satisfies BarKeyEvent

    expect(barCommandFor(chord('KeyF', { ctrlKey: true }), 'replace')).toBe('show-find')
    expect(barCommandFor(chord('KeyF', { metaKey: true }), 'find')).toBe('show-find')
    expect(barCommandFor(chord('KeyH', { ctrlKey: true }), 'find')).toBe('show-replace')
    expect(barCommandFor(chord('KeyF', { metaKey: true, altKey: true }), 'find')).toBe(
      'show-replace',
    )
  })

  it('leaves every other key to the field', () => {
    expect(barCommandFor(press('a'), 'find')).toBeUndefined()
    expect(barCommandFor(press('c'), 'find')).toBeUndefined()
    expect(barCommandFor(press('c', { altKey: true, ctrlKey: true }), 'find')).toBeUndefined()
    expect(barCommandFor(press('Enter', { altKey: true }), 'find')).toBeUndefined()
    expect(barCommandFor(press('Enter', { shiftKey: true }), 'replace')).toBeUndefined()
  })
})
