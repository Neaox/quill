import { describe, expect, it } from 'vitest'

import { renderPreviewBanner } from './preview-banner.ts'

describe('the reader preview banner', () => {
  it('is a labelled landmark that says what the page is', () => {
    const html = renderPreviewBanner({ closeHref: '/w/eng/d/overview-k1', publicHref: null }).value
    expect(html).toContain('<aside class="site-preview" aria-label="Reader preview">')
    expect(html).toContain('Preview')
    expect(html).toContain('Not on the public web')
  })

  it('leads back to the document in the app, with a name a screen reader can say', () => {
    const html = renderPreviewBanner({ closeHref: '/w/eng/d/overview-k1', publicHref: null }).value
    expect(html).toMatch(/<a class="site-preview-close" href="\/w\/eng\/d\/overview-k1"/u)
    expect(html).toContain('Close preview')
  })

  it('links to the live page when there is one', () => {
    const html = renderPreviewBanner({
      closeHref: '/w/eng/d/overview-k1',
      publicHref: '/s/acme/guides/overview',
    }).value
    expect(html).toContain('href="/s/acme/guides/overview"')
    expect(html).toContain('Live on the web')
    expect(html).not.toContain('Not on the public web')
  })

  it('says it is the unpublished draft, and leads back to editing it, when it is one', () => {
    const html = renderPreviewBanner({
      closeHref: '/w/eng/d/overview-k1',
      publicHref: '/s/acme/guides/overview',
      draft: { editHref: '/w/eng/d/overview-k1/edit' },
    }).value

    expect(html).toContain('Unpublished changes')
    expect(html).toContain('href="/w/eng/d/overview-k1/edit"')
    expect(html).toContain('Resume editing')
    // What the web shows is what is published, which is not what is being looked at.
    expect(html).not.toContain('Live on the web')
    expect(html).not.toContain('Not on the public web')
  })

  it('escapes the addresses it is given', () => {
    const html = renderPreviewBanner({ closeHref: '"><script>', publicHref: null }).value
    expect(html).not.toContain('<script>')
  })
})
