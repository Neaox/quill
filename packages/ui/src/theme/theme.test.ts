import { describe, expect, it } from 'vitest'

import {
  applyThemePreference,
  isThemePreference,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  THEME_ATTRIBUTE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreference,
  type ThemeStorage,
} from './theme.ts'

function memoryStorage(initial: Record<string, string> = {}): ThemeStorage & {
  readonly values: Map<string, string>
} {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

function refusingStorage(): ThemeStorage {
  return {
    getItem: () => {
      throw new Error('site data is blocked')
    },
    setItem: () => {
      throw new Error('site data is blocked')
    },
  }
}

describe('THEME_PREFERENCES', () => {
  it('offers light, dark, and following the system', () => {
    expect(THEME_PREFERENCES).toEqual(['light', 'dark', 'system'])
  })
})

describe('isThemePreference', () => {
  it.each(['light', 'dark', 'system'])('accepts %s', (value) => {
    expect(isThemePreference(value)).toBe(true)
  })

  it.each([null, undefined, '', 'Dark', 0, {}])('rejects %s', (value) => {
    expect(isThemePreference(value)).toBe(false)
  })
})

describe('resolveTheme', () => {
  it('follows the system when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('ignores the system when the preference is explicit', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('applyThemePreference', () => {
  it.each(['light', 'dark'] as const)('writes %s onto the element', (preference) => {
    const element = document.createElement('html')

    applyThemePreference(element, preference)

    expect(element.getAttribute(THEME_ATTRIBUTE)).toBe(preference)
  })

  it('removes the attribute for system, leaving prefers-color-scheme in charge', () => {
    const element = document.createElement('html')
    element.setAttribute(THEME_ATTRIBUTE, 'dark')

    applyThemePreference(element, 'system')

    expect(element.hasAttribute(THEME_ATTRIBUTE)).toBe(false)
  })
})

describe('readThemePreference', () => {
  it('returns a remembered preference', () => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: 'dark' })

    expect(readThemePreference(storage)).toBe('dark')
  })

  it('falls back to system when nothing is remembered', () => {
    expect(readThemePreference(memoryStorage())).toBe('system')
  })

  it('falls back to system when the remembered value is not a preference', () => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: 'sepia' })

    expect(readThemePreference(storage)).toBe('system')
  })

  it('falls back to system when storage refuses to be read', () => {
    expect(readThemePreference(refusingStorage())).toBe('system')
  })
})

describe('writeThemePreference', () => {
  it.each(THEME_PREFERENCES)('remembers %s', (preference: ThemePreference) => {
    const storage = memoryStorage()

    writeThemePreference(storage, preference)

    expect(storage.values.get(THEME_STORAGE_KEY)).toBe(preference)
  })

  it('ignores a storage that refuses to be written', () => {
    expect(() => writeThemePreference(refusingStorage(), 'dark')).not.toThrow()
  })
})
