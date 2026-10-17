import { loadPublicSite, resolvePublicMenu } from '@quill/application'
import type {
  OrganisationSettings,
  PublicSite,
  PublicSiteLoader,
  ResolvedPublicMenu,
} from '@quill/application'

import type { AppDependencies } from '../dependencies.ts'

/**
 * The site at a slug, from the public site cache when it is fresh
 * (`cache.ts`). `null` is the one answer every reason gives — an unknown slug,
 * a site switched off, an organisation that no longer publishes, settings this
 * release cannot read.
 */
export function cachedPublicSiteLoader(
  deps: Pick<AppDependencies, 'publicSiteCache'> & Parameters<typeof loadPublicSite>[0],
): PublicSiteLoader {
  return async (siteSlug: string): Promise<PublicSite | null> => {
    const known = deps.publicSiteCache.site(siteSlug)
    if (known !== null) return known
    const loaded = await loadPublicSite(deps, siteSlug)
    if (loaded.kind !== 'site') return null
    deps.publicSiteCache.rememberSite(siteSlug, loaded.site)
    return loaded.site
  }
}

/**
 * The organisation's header menu, resolved, from the cache when it is fresh.
 *
 * One for the whole instance: every page of every site, and the reader
 * preview, carries the same menu, so it is resolved once and kept beside the
 * pages it is rendered into. The sites its links point at are read through the
 * same cache the pages are served from, so resolving it costs nothing a page
 * of those sites has not already paid for (`resolvePublicMenu`).
 */
export async function cachedHeaderMenu(
  deps: Pick<AppDependencies, 'publicSiteCache' | 'uow'> & Parameters<typeof loadPublicSite>[0],
  organisation: OrganisationSettings,
): Promise<ResolvedPublicMenu> {
  const held = deps.publicSiteCache.menu()
  if (held !== null) return held
  const menu = await resolvePublicMenu(
    { uow: deps.uow, loadSite: cachedPublicSiteLoader(deps) },
    organisation.publicMenu,
  )
  deps.publicSiteCache.rememberMenu(menu)
  return menu
}
