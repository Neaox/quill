import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { NotificationsDto } from './types.ts'

/** How often the bell asks again while a tab is in front: a minute, not a stream. */
const REFRESH_MS = 60_000

/**
 * What has happened that concerns the signed-in person, newest first, and how many of it is
 * unread (ADR-052). It is on every signed-in page, so it asks again each minute while the
 * tab is in front and on returning to it, and not at all in a background tab.
 */
export function useNotifications() {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: () => request<NotificationsDto>(client.GET('/api/me/notifications')),
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  })
}

/** Marks some notifications read, or all of them when none are named. */
export function useMarkNotificationsRead() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids?: readonly string[]) =>
      request<void>(
        client.POST('/api/me/notifications/read', {
          body: ids === undefined ? {} : { ids: [...ids] },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications() })
    },
  })
}
