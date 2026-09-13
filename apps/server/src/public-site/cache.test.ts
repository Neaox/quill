import { describe, expect, it } from 'vitest'
import type { PublicSite } from '@quill/application'

import { createFakeClock } from '../test-support/fakes.ts'
import { createPublicSiteCache, PUBLIC_SITE_CACHE_TTL_MS } from './cache.ts'

/**
 * What the public site remembers, and — more to the point — the three ways it
 * is made to forget: an event, the clock, and its own size.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z')

const aSite = (siteSlug: string): PublicSite => ({ siteSlug }) as unknown as PublicSite
const aPage = (html: string) => ({ html, etag: `"${html}"` })

const cache = (ttlMs = PUBLIC_SITE_CACHE_TTL_MS, bounds = {}) => {
  const clock = createFakeClock(NOW)
  return { clock, cache: createPublicSiteCache({ clock, ttlMs, ...bounds }) }
}

describe('the public site cache', () => {
  it('answers with what it was given', () => {
    const { cache: held } = cache()
    held.rememberSite('acme', aSite('acme'))
    held.rememberPage('acme', 'guides/one', aPage('<p>one</p>'))
    expect(held.site('acme')?.siteSlug).toBe('acme')
    expect(held.page('acme', 'guides/one')).toEqual(aPage('<p>one</p>'))
  })

  it('knows nothing it has not been told', () => {
    const { cache: held } = cache()
    expect(held.site('acme')).toBeNull()
    expect(held.page('acme', 'guides/one')).toBeNull()
  })

  it('keeps two sites, and two pages of one site, apart', () => {
    const { cache: held } = cache()
    held.rememberPage('acme', 'guides/one', aPage('<p>acme one</p>'))
    held.rememberPage('other', 'guides/one', aPage('<p>other one</p>'))
    held.rememberPage('acme', 'guides/two', aPage('<p>acme two</p>'))
    expect(held.page('acme', 'guides/one')?.html).toBe('<p>acme one</p>')
    expect(held.page('other', 'guides/one')?.html).toBe('<p>other one</p>')
    expect(held.page('acme', 'guides/two')?.html).toBe('<p>acme two</p>')
  })

  it('forgets everything when something changes, because the navigation is on every page', () => {
    const { cache: held } = cache()
    held.rememberSite('acme', aSite('acme'))
    held.rememberPage('acme', 'guides/one', aPage('<p>one</p>'))
    held.invalidate()
    expect(held.site('acme')).toBeNull()
    expect(held.page('acme', 'guides/one')).toBeNull()
  })

  it('forgets an entry once its time is up', () => {
    const { clock, cache: held } = cache(1_000)
    held.rememberSite('acme', aSite('acme'))
    held.rememberPage('acme', 'guides/one', aPage('<p>one</p>'))

    clock.advance(999)
    expect(held.site('acme')).not.toBeNull()

    clock.advance(1)
    expect(held.site('acme')).toBeNull()
    expect(held.page('acme', 'guides/one')).toBeNull()
  })

  /** Reading must not extend a life: the value is only ever as fresh as its write. */
  it('measures the time from when an entry was written, not from when it was read', () => {
    const { clock, cache: held } = cache(1_000)
    held.rememberSite('acme', aSite('acme'))
    clock.advance(500)
    expect(held.site('acme')).not.toBeNull()
    clock.advance(500)
    expect(held.site('acme')).toBeNull()
  })

  it('holds nothing at all when the time to live is zero', () => {
    const { cache: held } = cache(0)
    held.rememberSite('acme', aSite('acme'))
    held.rememberPage('acme', 'guides/one', aPage('<p>one</p>'))
    expect(held.site('acme')).toBeNull()
    expect(held.page('acme', 'guides/one')).toBeNull()
  })

  it('is bounded, oldest first, so a crawler cannot grow it without limit', () => {
    const { cache: held } = cache(PUBLIC_SITE_CACHE_TTL_MS, { maxSites: 2, maxPages: 2 })
    for (const slug of ['one', 'two', 'three']) held.rememberSite(slug, aSite(slug))
    expect(held.site('one')).toBeNull()
    expect(held.site('two')).not.toBeNull()
    expect(held.site('three')).not.toBeNull()

    for (const path of ['a', 'b', 'c']) held.rememberPage('acme', path, aPage(path))
    expect(held.page('acme', 'a')).toBeNull()
    expect(held.page('acme', 'c')).not.toBeNull()
  })

  it('replaces an entry it already holds rather than counting it twice', () => {
    const { cache: held } = cache(PUBLIC_SITE_CACHE_TTL_MS, { maxPages: 2 })
    held.rememberPage('acme', 'a', aPage('first'))
    held.rememberPage('acme', 'a', aPage('second'))
    held.rememberPage('acme', 'b', aPage('b'))
    expect(held.page('acme', 'a')?.html).toBe('second')
    expect(held.page('acme', 'b')).not.toBeNull()
  })

  it('never holds a page longer than a shared cache in front of it may', () => {
    // `PAGE_SHARED_MAX_AGE_SECONDS` is sixty; this must not exceed it, or the
    // cache would be the staler of the two and the contract doc would be wrong.
    expect(PUBLIC_SITE_CACHE_TTL_MS).toBeLessThanOrEqual(60_000)
  })
})
