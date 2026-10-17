import { describe, expect, it } from 'vitest'

import { drawioEditorUrl } from './drawio-protocol.ts'

describe('the draw.io editor address', () => {
  it('asks for the interface language when the reader’s is known', () => {
    const url = new URL(drawioEditorUrl('https://draw.example.com/', { dark: false, lang: 'de' }))
    expect(url.searchParams.get('lang')).toBe('de')
    expect(url.searchParams.get('dark')).toBe('0')
  })

  it('leaves the language to draw.io when it is not', () => {
    const url = new URL(drawioEditorUrl('https://draw.example.com/', { dark: true }))
    expect(url.searchParams.has('lang')).toBe(false)
    expect(url.searchParams.get('dark')).toBe('1')
  })
})
