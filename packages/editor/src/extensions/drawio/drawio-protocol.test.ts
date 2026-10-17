import { describe, expect, it } from 'vitest'

import { drawioEditorUrl, drawioLanguage } from './drawio-protocol.ts'

describe('the draw.io editor address', () => {
  it('asks for the dark interface when the reader uses it', () => {
    const url = new URL(drawioEditorUrl('https://draw.example.com/', { dark: true }))
    expect(url.searchParams.get('dark')).toBe('1')
  })

  it('asks for the interface language when the reader’s is known', () => {
    const url = new URL(drawioEditorUrl('https://draw.example.com/', { dark: false, lang: 'de' }))
    expect(url.searchParams.get('lang')).toBe('de')
    expect(url.searchParams.get('dark')).toBe('0')
  })

  it('leaves the language to draw.io when it is not', () => {
    const url = new URL(drawioEditorUrl('https://draw.example.com/', { dark: true }))
    expect(url.searchParams.has('lang')).toBe(false)
  })
})

describe('the language draw.io is asked for', () => {
  it.each([
    ['en', 'en'],
    ['en-NZ', 'en'],
    ['de-DE', 'de'],
    ['FR', 'fr'],
    ['pt-BR', 'pt-br'],
    ['pt-PT', 'pt'],
    ['zh-TW', 'zh-tw'],
    ['zh-Hant', 'zh-tw'],
    ['zh-HK', 'zh-tw'],
    ['zh-CN', 'zh'],
    ['zh-Hans', 'zh'],
  ])('is %s as draw.io names it, %s', (tag, expected) => {
    expect(drawioLanguage(tag)).toBe(expected)
  })

  it('is nothing for a tag that names no language', () => {
    expect(drawioLanguage('')).toBeUndefined()
    expect(drawioLanguage('  ')).toBeUndefined()
    expect(drawioLanguage('x-private')).toBeUndefined()
  })
})
