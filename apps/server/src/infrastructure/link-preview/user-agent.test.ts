import { BRAND } from '@quill/brand'
import { describe, expect, it } from 'vitest'

import { BOT_VERSION, linkPreviewUserAgent } from './user-agent.ts'

describe('linkPreviewUserAgent', () => {
  it('names the product, the behaviour version, and where to read about the bot', () => {
    expect(linkPreviewUserAgent('https://docs.example.com')).toBe(
      `${BRAND.name}Bot/${BOT_VERSION} (+https://docs.example.com/bot)`,
    )
  })

  it('points at the instance, not at a path or a query inside it', () => {
    expect(linkPreviewUserAgent('https://docs.example.com/app/?x=1')).toContain(
      '(+https://docs.example.com/bot)',
    )
  })

  it('keeps a port, which is part of where the instance is', () => {
    expect(linkPreviewUserAgent('http://localhost:3000')).toContain('(+http://localhost:3000/bot)')
  })

  it('is a single header line with nothing a header may not carry', () => {
    expect(linkPreviewUserAgent('https://docs.example.com')).toMatch(/^[\x20-\x7e]+$/u)
  })
})
