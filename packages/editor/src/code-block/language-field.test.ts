import { describe, expect, it, vi } from 'vitest'

import { act } from '@testing-library/react'

import { codeMirrorSource, createLanguageField, languageName } from './language-field.ts'

describe('the language fieldâ€™s helpers', () => {
  it('names a language, a fence nothing knows, and no language at all', () => {
    expect(languageName('ts')).toBe('TypeScript')
    expect(languageName('kotlin')).toBe('kotlin')
    expect(languageName('')).toBeUndefined()
    expect(languageName(null)).toBeUndefined()
  })

  it('copies nothing, and selects nothing, where no code editor has been drawn', () => {
    const source = codeMirrorSource(() => null)
    expect(source.read()).toEqual({ text: '', mode: 'code' })
    expect(() => {
      source.select()
    }).not.toThrow()
  })
})

const callbacks = { commit: () => true, cancel: vi.fn<() => void>() }
const input = (field: { element: HTMLElement }) => field.element.querySelector('input')
const drawn = (field: { element: HTMLElement }) => input(field) !== null

describe('the language field’s picker', () => {
  it('is drawn as soon as it is shown a language', async () => {
    const field = createLanguageField(callbacks)
    await act(async () => {
      field.show('ts')
    })
    expect(drawn(field)).toBe(true)
    field.destroy()
  })

  it('is not drawn until it is wanted, and then shows the language it was last given', async () => {
    const field = createLanguageField({ ...callbacks, deferred: true })
    await act(async () => {
      field.show('ts')
      field.show('python')
    })
    expect(drawn(field)).toBe(false)
    await act(async () => {
      field.draw()
    })
    expect(drawn(field)).toBe(true)
    expect(input(field)?.value).toBe('Python')
    field.destroy()
  })

  it('is drawn when wanted before it is shown anything, and follows a language shown after', async () => {
    const field = createLanguageField({ ...callbacks, deferred: true })
    await act(async () => {
      field.draw()
    })
    expect(drawn(field)).toBe(false)
    await act(async () => {
      field.show('ts')
    })
    expect(input(field)?.value).toBe('TypeScript')
    await act(async () => {
      field.show('python')
    })
    expect(input(field)?.value).toBe('Python')
    field.destroy()
  })

  it('draws nothing once it has been taken down', async () => {
    const field = createLanguageField({ ...callbacks, deferred: true })
    field.show('ts')
    field.destroy()
    await act(async () => {
      await Promise.resolve()
    })
    expect(() => {
      field.draw()
    }).not.toThrow()
    expect(drawn(field)).toBe(false)
  })
})
