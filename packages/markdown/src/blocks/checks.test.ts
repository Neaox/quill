import { describe, expect, it } from 'vitest'

import type { CustomEmoji } from '../emoji/emoji.ts'
import { parseMarkdown } from '../pipeline/processor.ts'
import { renderDocument } from '../render/html.ts'

const EMOJI: ReadonlyMap<string, CustomEmoji> = new Map([
  ['key', { src: '/api/emoji/key.0123456789abcdef.svg', width: 16, height: 16 }],
])

const rendered = (markdown: string) => renderDocument(parseMarkdown(markdown), { emoji: EMOJI })

describe(':::checks', () => {
  it('stays an ordered list, one item a check', () => {
    expect(
      rendered(
        ':::checks\n\n1. The request is well formed\n2. The reader belongs to the branch\n3. Within the rate limit\n\n:::\n',
      ).html,
    ).toBe(
      [
        '<article><ol class="qb qb-checks">',
        '<li>The request is well formed</li>',
        '<li>The reader belongs to the branch</li>',
        '<li>Within the rate limit</li>',
        '</ol></article>',
      ].join(''),
    )
  })

  it('draws each check as inline Markdown, emoji and all', () => {
    expect(rendered(':::checks\n1. The :key: `token` is **valid**\n:::\n').html).toContain(
      '<li>The <img class="emoji" src="/api/emoji/key.0123456789abcdef.svg" alt="key" title=":key:" width="20" height="20"> <code>token</code> is <strong>valid</strong></li>',
    )
  })

  it('counts from one, whatever number the list starts at', () => {
    expect(rendered(':::checks\n3. Third\n4. Fourth\n:::\n').html).toBe(
      '<article><ol class="qb qb-checks"><li>Third</li><li>Fourth</li></ol></article>',
    )
  })

  it('is a numbered list and nothing else, and says so through its frame', () => {
    const bullets = rendered(':::checks\n- One\n:::\n')
    expect(bullets.html).toContain(
      'aria-label="checks holds a numbered list, one check a line: checks"',
    )
    expect(bullets.html).toContain('<li>One</li>')
    expect(bullets.blockIssues.map((issue) => issue.message)).toEqual([
      'checks holds a numbered list, one check a line',
    ])
    expect(rendered(':::checks\nWords.\n:::\n').blockIssues[0]?.message).toBe(
      'checks holds a numbered list, one check a line, and nothing else',
    )
    expect(rendered(':::checks\n1. One\n\n   - nested\n:::\n').blockIssues[0]?.message).toBe(
      'each item of checks is one line',
    )
  })

  it('takes no props, and reports one before it, outside the list', () => {
    const result = rendered(':::checks{compact}\n1. One\n:::\n')
    expect(result.html).toBe(
      [
        '<article><p class="block-issues"><span class="block-issues-label">Check this block</span>',
        ' compact is not a prop of this block; it takes none.</p>\n',
        '<ol class="qb qb-checks"><li>One</li></ol></article>',
      ].join(''),
    )
  })
})
