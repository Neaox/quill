import { describe, expect, it } from 'vitest'

import { drawioEditorUrl } from './drawio-protocol.ts'

describe('the draw.io editor address', () => {
  it('asks for the dark interface when the reader uses it', () => {
    const url = new URL(drawioEditorUrl('https://draw.example.com/', { dark: true }))
    expect(url.searchParams.get('dark')).toBe('1')
  })
})
