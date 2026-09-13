import { BRAND } from '@quill/brand'

import { useOrganisationSettings } from '../../lib/api/index.ts'

/**
 * What this organisation calls itself, for the surfaces that carry its name.
 *
 * `GET /settings/organisation` needs only a session — deliberately, because
 * "every screen renders with the theme, the navigation and the policies in
 * them" (`docs/architecture/api-contract-settings.md`) — so any signed-in
 * surface may ask, and they all read the one cache entry.
 *
 * It falls back to the product's own name rather than to nothing: the query
 * is not awaited by any loader, so the first paint of a cold session has no
 * answer yet, and a bar that flashes empty is worse than one that briefly
 * says what the product is called. An instance that has never been through
 * settings is answered the same name by the server anyway
 * (`defaultOrganisationSettings`), so for most instances the fallback and the
 * answer agree.
 */
export function useOrganisationName(): string {
  const settings = useOrganisationSettings()
  const name = settings.data?.settings.name
  return name === undefined || name.trim() === '' ? BRAND.name : name
}
