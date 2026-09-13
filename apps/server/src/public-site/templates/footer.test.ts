import { describe, expect, it } from 'vitest'

import { renderFooter } from './footer.ts'

describe('the page footer', () => {
  it('names the organisation and stamps the page with an absolute date', () => {
    const html = renderFooter({
      organisationName: 'Acme',
      updatedAt: new Date('2026-08-15T10:00:00.000Z'),
    }).value
    expect(html).toContain('<footer class="site-footer">')
    expect(html).toContain('Acme')
    expect(html).toContain('<time datetime="2026-08-15T10:00:00.000Z"')
    expect(html).toContain('15 August 2026')
  })

  it('says nothing about a date on a page that is not a document', () => {
    const html = renderFooter({ organisationName: 'Acme', updatedAt: null }).value
    expect(html).not.toContain('<time')
    expect(html).toContain('Acme')
  })

  it('escapes the organisation name, which an administrator typed', () => {
    expect(renderFooter({ organisationName: '<script>', updatedAt: null }).value).toContain(
      '&lt;script&gt;',
    )
  })
})
