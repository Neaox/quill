import { describe, expect, it } from 'vitest'

import { renderLifecycleNotice } from './lifecycle-notice.ts'

describe('the deprecation notice', () => {
  it('says the page is deprecated and links to its replacement', () => {
    const html = renderLifecycleNotice({ href: '/s/docs/guide/setup', title: 'Setting up' }).value
    expect(html).toMatch(
      /<div\s+role="note"\s+class="lifecycle-notice"\s+data-lifecycle="deprecated"\s+aria-label="Deprecated"/u,
    )
    expect(html).toContain('This page is deprecated.')
    expect(html).toContain('Use <a href="/s/docs/guide/setup">Setting up</a> instead.')
  })

  it('says it is kept for reference when there is no replacement this reader may follow', () => {
    const html = renderLifecycleNotice(undefined).value
    expect(html).toContain('kept for reference')
    expect(html).not.toContain('<a ')
  })

  it('escapes the replacement’s title, because it is an author’s', () => {
    const html = renderLifecycleNotice({
      href: '/s/x',
      title: '<img src=x onerror=alert(1)>',
    }).value
    expect(html).not.toContain('<img')
  })
})
