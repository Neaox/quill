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

  it('holds the one resolved header menu, and forgets it with everything else', () => {
    const { clock, cache: held } = cache(1_000)
    expect(held.menu()).toBeNull()
    const menu = [
      {
        kind: 'link',
        link: { label: 'Status', href: 'https://s.test', external: true, referrer: 'hidden' },
      },
    ] as const
    held.rememberMenu(menu)
    expect(held.menu()).toEqual(menu)
    held.invalidate()
    expect(held.menu()).toBeNull()

    held.rememberMenu(menu)
    clock.advance(1_000)
    expect(held.menu()).toBeNull()
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

describe('what the public site remembers of its searches', () => {
  it('answers a repeated question with the answer it already rendered', () => {
    const { cache: held } = cache()
    held.rememberSearch('acme', 'rate limit', undefined, aPage('<p>results</p>'))
    expect(held.search('acme', 'rate limit', undefined)).toEqual(aPage('<p>results</p>'))
  })

  it('keeps apart two sites, two questions and two pages of one question', () => {
    const { cache: held } = cache()
    held.rememberSearch('acme', 'limit', undefined, aPage('<p>acme first</p>'))
    held.rememberSearch('acme', 'limit', 'page-2', aPage('<p>acme second</p>'))
    held.rememberSearch('other', 'limit', undefined, aPage('<p>other first</p>'))
    held.rememberSearch('acme', 'other words', undefined, aPage('<p>acme other</p>'))
    expect(held.search('acme', 'limit', undefined)?.html).toBe('<p>acme first</p>')
    expect(held.search('acme', 'limit', 'page-2')?.html).toBe('<p>acme second</p>')
    expect(held.search('other', 'limit', undefined)?.html).toBe('<p>other first</p>')
    expect(held.search('acme', 'other words', undefined)?.html).toBe('<p>acme other</p>')
  })

  it('cannot be made to run two questions together by what a stranger typed', () => {
    const { cache: held } = cache()
    held.rememberSearch('acme', 'a\nb', undefined, aPage('<p>one</p>'))
    expect(held.search('acme', 'a', 'b')).toBeNull()
    expect(held.search('acme\na', 'b', undefined)).toBeNull()
  })

  it('forgets with everything else when something is published, and when the clock says so', () => {
    const { clock, cache: held } = cache(1_000)
    held.rememberSearch('acme', 'limit', undefined, aPage('<p>x</p>'))
    clock.advance(999)
    expect(held.search('acme', 'limit', undefined)).not.toBeNull()
    clock.advance(1)
    expect(held.search('acme', 'limit', undefined)).toBeNull()

    held.rememberSearch('acme', 'limit', undefined, aPage('<p>x</p>'))
    held.invalidate()
    expect(held.search('acme', 'limit', undefined)).toBeNull()
  })

  it('has a bound of its own, so a stranger’s questions cannot push real pages out', () => {
    const { cache: held } = cache(PUBLIC_SITE_CACHE_TTL_MS, { maxPages: 2, maxSearches: 2 })
    held.rememberPage('acme', 'guides/one', aPage('<p>one</p>'))
    for (const query of ['a', 'b', 'c', 'd']) {
      held.rememberSearch('acme', query, undefined, aPage(`<p>${query}</p>`))
    }
    expect(held.page('acme', 'guides/one')).not.toBeNull()
    expect(held.search('acme', 'a', undefined)).toBeNull()
    expect(held.search('acme', 'd', undefined)).not.toBeNull()
  })

  it('remembers nothing when the cache is switched off', () => {
    const { cache: held } = cache(0)
    held.rememberSearch('acme', 'limit', undefined, aPage('<p>x</p>'))
    expect(held.search('acme', 'limit', undefined)).toBeNull()
  })
})
