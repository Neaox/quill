import { describe, expect, it } from 'vitest'

import {
  ANIMATED_IMAGES_ATTRIBUTE,
  ANIMATED_IMAGES_PREFERENCES,
  ANIMATED_IMAGES_STORAGE_KEY,
  applyAnimatedImagesPreference,
  isAnimatedImagesPreference,
  readAnimatedImagesPreference,
  rememberAnimatedImagesPreference,
} from './animated-images.ts'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

const blockedStorage = {
  getItem: (): string | null => {
    throw new Error('blocked')
  },
  setItem: (): void => {
    throw new Error('blocked')
  },
}

describe('the animated images contract', () => {
  it('is an attribute on the root and a key in storage that the public site shares', () => {
    expect(ANIMATED_IMAGES_ATTRIBUTE).toBe('data-animated-images')
    expect(ANIMATED_IMAGES_STORAGE_KEY).toBe('animated-images-preference')
    expect(ANIMATED_IMAGES_PREFERENCES).toEqual(['brief', 'hover', 'never'])
  })

  it('recognises only the three preferences', () => {
    expect(isAnimatedImagesPreference('hover')).toBe(true)
    expect(isAnimatedImagesPreference('always')).toBe(false)
    expect(isAnimatedImagesPreference(null)).toBe(false)
  })
})

describe('applyAnimatedImagesPreference', () => {
  it('writes the preference onto the element', () => {
    const root = document.createElement('html')
    applyAnimatedImagesPreference(root, 'never')
    expect(root.getAttribute('data-animated-images')).toBe('never')
    applyAnimatedImagesPreference(root, 'brief')
    expect(root.getAttribute('data-animated-images')).toBe('brief')
  })
})

describe('readAnimatedImagesPreference', () => {
  it('is what the element says', () => {
    const root = document.createElement('html')
    root.setAttribute('data-animated-images', 'hover')
    expect(readAnimatedImagesPreference(root)).toBe('hover')
  })

  it('is brief when the attribute is absent or not a preference', () => {
    const root = document.createElement('html')
    expect(readAnimatedImagesPreference(root)).toBe('brief')
    root.setAttribute('data-animated-images', 'sometimes')
    expect(readAnimatedImagesPreference(root)).toBe('brief')
  })
})

describe('rememberAnimatedImagesPreference', () => {
  it('mirrors the preference into storage', () => {
    const storage = memoryStorage()
    rememberAnimatedImagesPreference('hover', () => storage)
    expect(storage.values.get('animated-images-preference')).toBe('hover')
  })

  it('does nothing, and throws nothing, when storage is blocked', () => {
    expect(() => {
      rememberAnimatedImagesPreference('never', () => blockedStorage)
    }).not.toThrow()
  })

  it('throws nothing when even reaching storage is refused', () => {
    expect(() => {
      rememberAnimatedImagesPreference('never', () => {
        throw new Error('SecurityError')
      })
    }).not.toThrow()
  })

  it('uses the page’s own storage by default', () => {
    rememberAnimatedImagesPreference('never')
    expect(localStorage.getItem('animated-images-preference')).toBe('never')
    localStorage.removeItem('animated-images-preference')
  })
})
