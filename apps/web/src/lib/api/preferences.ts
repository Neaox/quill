import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ApiClient, paths } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'

/**
 * The signed-in person's own preferences (ADR-034;
 * `docs/architecture/api-contract-settings.md`, "Person preferences").
 *
 * Every field is filled in by the server, defaults included, so a screen
 * never decides what an absent preference means.
 */
export type PersonPreferences =
  paths['/api/me/preferences']['get']['responses'][200]['content']['application/json']

export function personPreferencesQueryOptions(client: ApiClient) {
  return {
    queryKey: queryKeys.personPreferences(),
    queryFn: (): Promise<PersonPreferences> => request(client.GET('/api/me/preferences', {})),
  }
}

export function usePersonPreferences() {
  const client = useApiClient()
  return useQuery(personPreferencesQueryOptions(client))
}

/**
 * `PUT /api/me/preferences`: the whole set, a preference left out returning
 * to its default. The answer is the new effective state, so it replaces the
 * cache entry rather than invalidating it.
 */
export function useSavePersonPreferences() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (preferences: PersonPreferences) =>
      request(client.PUT('/api/me/preferences', { body: preferences })),
    onSuccess: (saved: PersonPreferences) => {
      queryClient.setQueryData(queryKeys.personPreferences(), saved)
    },
  })
}
