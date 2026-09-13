import { useQuery } from '@tanstack/react-query'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { OidcProviderList } from './types.ts'

/**
 * The identity providers this instance offers (ADR-011's home-realm
 * discovery, first version: the buttons).
 *
 * It is read before anybody is signed in and on an instance that may have
 * none, so a failure is not an error the person should see — it is "there are
 * no buttons". `retry: false` keeps a misconfigured or offline instance from
 * making the sign-in page feel broken while it backs off.
 */
export function useOidcProviders() {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.oidcProviders,
    queryFn: () => request<OidcProviderList>(client.GET('/api/auth/oidc/providers', {})),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * Where "Continue with …" goes.
 *
 * A full-page navigation, never a `fetch`: the browser has to *leave* for the
 * provider and come back with a cookie, which is a top-level navigation by
 * definition. That is why the sign-in page renders an anchor styled as a
 * button rather than a button with a handler.
 */
export function oidcStartPath(providerId: string, redirect: string | undefined): string {
  const query = redirect === undefined ? '' : `?redirect=${encodeURIComponent(redirect)}`
  return `/api/auth/oidc/${encodeURIComponent(providerId)}/start${query}`
}
