import { describe, expect, it } from 'vitest'

import { renderByline } from './byline.ts'

const tagHref = (tag: string) => `/s/docs/search?q=${encodeURIComponent(`tag:${tag}`)}`

describe('the public byline', () => {
  it('states the public facts as the application does: one description list, the same classes', () => {
    const html = renderByline({
      facts: {
        status: undefined,
        lifecycle: { state: 'in-review' },
        tags: ['ops', 'On call'],
        lastReviewed: '2026-01-02',
      },
      tagHref,
    }).value
    expect(html).toContain('<div role="group" aria-label="Document properties" class="byline">')
    expect(html).toContain('<dl class="byline-facts">')
    expect(html).toMatch(/<dt class="byline-term">Lifecycle<\/dt>/u)
    expect(html).toMatch(
      /<span data-lifecycle="in-review" class="byline-lifecycle"\s*>In review<\/span/u,
    )
    expect(html).toContain('Reviewed <time datetime="2026-01-02">2 Jan 2026</time>')
    expect(html).toContain('<ul aria-label="Tags" class="byline-list">')
    expect(html).toContain(
      '<a class="byline-tag badge" data-label="ops" href="/s/docs/search?q=tag%3Aops">ops</a>',
    )
    // A tag no label could be named carries no label hook.
    expect(html).toContain(
      '<a class="byline-tag badge" href="/s/docs/search?q=tag%3AOn%20call">On call</a>',
    )
    expect(html.indexOf('In review')).toBeLessThan(html.indexOf('Reviewed'))
    expect(html.indexOf('Reviewed')).toBeLessThan(html.indexOf('ops'))
  })

  it('shows tags as words where the site has no search to send them to', () => {
    const html = renderByline({
      facts: { status: undefined, lifecycle: undefined, tags: ['ops'], lastReviewed: undefined },
      tagHref: null,
    }).value
    expect(html).toContain('<span class="byline-tag badge" data-label="ops">ops</span>')
    expect(
      renderByline({
        facts: {
          status: undefined,
          lifecycle: undefined,
          tags: ['On call'],
          lastReviewed: undefined,
        },
        tagHref: null,
      }).value,
    ).toContain('<span class="byline-tag badge">On call</span>')
    expect(html).not.toContain('<a ')
  })

  it('is nothing at all for a document that states nothing public', () => {
    expect(
      renderByline({
        facts: { status: undefined, lifecycle: undefined, tags: [], lastReviewed: undefined },
        tagHref,
      }).value,
    ).toBe('')
  })

  it('escapes every value, because every value is an author’s', () => {
    const html = renderByline({
      facts: {
        status: undefined,
        lifecycle: undefined,
        tags: ['<script>alert(1)</script>', '"><img src=x>'],
        lastReviewed: undefined,
      },
      tagHref,
    }).value
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('says when a page was verified, and never by whom', () => {
    const html = renderByline({
      facts: {
        status: undefined,
        lifecycle: { state: 'verified', verifiedAt: '2026-10-02' },
        tags: [],
        lastReviewed: undefined,
      },
      tagHref,
    }).value
    expect(html).toMatch(/data-lifecycle="verified" class="byline-lifecycle"\s*>Verified</u)
    expect(html).toContain('<time datetime="2026-10-02">2 Oct 2026</time>')
  })

  it('never shows a status from before the lifecycle', () => {
    expect(
      renderByline({
        facts: { status: 'archived', lifecycle: undefined, tags: [], lastReviewed: undefined },
        tagHref,
      }).value,
    ).toBe('')
  })
})
