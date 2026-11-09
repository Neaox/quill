import { describe, expect, it } from 'vitest'

import type { CustomEmoji } from '../emoji/emoji.ts'
import { standardEmoji } from '../emoji/shortcodes.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { renderHtml } from './html.ts'

const EMOJI: ReadonlyMap<string, CustomEmoji> = new Map([
  ['clock', { src: '/api/emoji/clock.0123456789abcdef.svg', width: 16, height: 16 }],
])

const paragraph = (markdown: string): string =>
  renderHtml(parseMarkdown(markdown), { emoji: EMOJI, standardEmoji })
    .replace(/^<article><p>/u, '')
    .replace(/<\/p><\/article>$/u, '')

describe('badges', () => {
  it('name the shorthand they are written with, beside its tone', () => {
    expect(paragraph(':ok[a] :warn[b] :bad[c] :accent[d] :plan[e]\n')).toBe(
      [
        '<span class="badge" data-tone="success" data-badge="ok">a</span>',
        '<span class="badge" data-tone="warning" data-badge="warn">b</span>',
        '<span class="badge" data-tone="danger" data-badge="bad">c</span>',
        '<span class="badge" data-tone="accent" data-badge="accent">d</span>',
        '<span class="badge" data-tone="neutral" data-badge="plan">e</span>',
      ].join(' '),
    )
  })

  it('name nothing when written in full, so `:plan` stays apart from a neutral badge', () => {
    expect(paragraph(':badge[Gap]{tone=neutral}\n')).toBe(
      '<span class="badge" data-tone="neutral">Gap</span>',
    )
  })

  it('draw a custom emoji in their label, so a time reads as one chip', () => {
    expect(paragraph(':accent[:clock: 5 s]\n')).toBe(
      '<span class="badge" data-tone="accent" data-badge="accent"><img class="emoji" src="/api/emoji/clock.0123456789abcdef.svg" alt="clock" title=":clock:" width="20" height="20"> 5 s</span>',
    )
  })

  it('draw a standard emoji and inline Markdown in their label', () => {
    expect(paragraph(':ok[:tada: **Shipped** `v2`]\n')).toBe(
      '<span class="badge" data-tone="success" data-badge="ok"><span class="emoji" role="img" aria-label="party popper">🎉</span> <strong>Shipped</strong> <code>v2</code></span>',
    )
  })

  it('keep a shortcode nothing answers to as written', () => {
    expect(paragraph(':warn[:nothing: late]\n')).toBe(
      '<span class="badge" data-tone="warning" data-badge="warn">:nothing: late</span>',
    )
  })

  it('still read `status:ok` as the author’s words', () => {
    expect(paragraph('status:ok\n')).toBe('status:ok')
  })

  it('never let a written attribute through as the shorthand’s name', () => {
    expect(paragraph(':badge[x]{data-badge=evil}\n')).toBe(
      '<span class="badge" data-tone="neutral">x</span>',
    )
  })
})
