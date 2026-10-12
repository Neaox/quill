import { useQuery, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { ApiClient } from '@quill/api-client'

import { organisationThemeQueryOptions } from '../../lib/api/index.ts'
import { createOrganisationThemeLink } from './organisation-theme-link.ts'

interface OrganisationThemeProps {
  readonly apiClient: ApiClient
  readonly queryClient: QueryClient
}

/**
 * Wears the organisation's theme on every screen (ADR-028, "Delivery").
 *
 * Rendered once, at the root of the route tree, so the sign-in page, a share
 * link and every signed-in screen all carry it, and a save on the theme
 * settings screen — which invalidates the summary — re-themes whatever is
 * open without a reload. It renders nothing: what it changes is the document
 * outside React, which is what the effects are for.
 *
 * The client and the cache come from the router's context rather than from
 * React context, because the root is the one component every route test
 * mounts, with or without the providers around it.
 *
 * A failure to read the theme is not shown to anybody: the page keeps the
 * built-in identity its bundle carries, which is a finished page.
 */
export function OrganisationTheme({ apiClient, queryClient }: OrganisationThemeProps) {
  const { data: theme } = useQuery(organisationThemeQueryOptions(apiClient), queryClient)
  const [link] = useState(() => createOrganisationThemeLink(document))

  // Synchronises with the document: takes the theme's <link> and
  // `data-theme-id` back off it when the application unmounts.
  useEffect(() => () => link.dispose(), [link])

  // Synchronises with the document: links the stylesheet the server names and
  // writes the identity on <html> once it has loaded.
  useEffect(() => {
    if (theme !== undefined) link.apply(theme)
  }, [link, theme])

  return null
}
