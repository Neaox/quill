import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { GroupSummaryDto, PersonDto } from './types.ts'

/**
 * Groups and the people in them (ADR-052). Every route is instance-admin only;
 * a non-admin's query settles into its error state with a `403`.
 */

export function groupsQueryOptions(client: ApiClient) {
  return {
    queryKey: queryKeys.groups(),
    queryFn: async (): Promise<readonly GroupSummaryDto[]> =>
      (await request<{ readonly groups: readonly GroupSummaryDto[] }>(client.GET('/api/groups')))
        .groups,
  }
}

/** Every group, ordered by unit path and then name. */
export function useGroups() {
  const client = useApiClient()
  return useQuery(groupsQueryOptions(client))
}

/** Who is in one group. Not asked until a group is chosen. */
export function useGroupMembers(groupId: string | undefined) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.groupMembers(groupId ?? ''),
    queryFn: async (): Promise<readonly PersonDto[]> =>
      (
        await request<{ readonly members: readonly PersonDto[] }>(
          client.GET('/api/groups/{id}/members', {
            params: { path: { id: groupId ?? '' } },
          }),
        )
      ).members,
    enabled: groupId !== undefined,
  })
}

/**
 * People whose name or email starts with `query`, at most twenty. A directory
 * moves slowly and a picker is typed into quickly, so what was found is kept
 * for a short while and the previous answer stays on screen while the next
 * one is on its way.
 */
export function usePeopleSearch(query: string, options: { readonly enabled?: boolean } = {}) {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.groupPeople(query),
    queryFn: async (): Promise<readonly PersonDto[]> =>
      (
        await request<{ readonly people: readonly PersonDto[] }>(
          client.GET('/api/people', { params: { query: { q: query } } }),
        )
      ).people,
    enabled: options.enabled ?? true,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  })
}

/**
 * A group write changes the list (names, counts) and, through the shared key
 * prefix, every group's member list. The list is a handful of rows, so
 * refetching it is cheaper than reasoning about which entries moved.
 */
function useInvalidateGroups() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.groups() })
}

export interface CreateGroupInput {
  readonly unitId: string
  readonly name: string
  /** Omitted for a group at the top of its unit, never `null` (Ajv would coerce it to `""`). */
  readonly parentGroupId?: string
}

export function useCreateGroup() {
  const client = useApiClient()
  const invalidate = useInvalidateGroups()
  return useMutation({
    mutationFn: ({ unitId, name, parentGroupId }: CreateGroupInput) =>
      request<{ readonly id: string }>(
        client.POST('/api/groups', {
          body: { unitId, name, ...(parentGroupId === undefined ? {} : { parentGroupId }) },
        }),
      ),
    onSuccess: invalidate,
  })
}

export interface RenameGroupInput {
  readonly groupId: string
  readonly name: string
}

export function useRenameGroup() {
  const client = useApiClient()
  const invalidate = useInvalidateGroups()
  return useMutation({
    mutationFn: ({ groupId, name }: RenameGroupInput) =>
      request<{ readonly id: string }>(
        client.PATCH('/api/groups/{id}', { params: { path: { id: groupId } }, body: { name } }),
      ),
    onSuccess: invalidate,
  })
}

export interface DeleteGroupInput {
  readonly groupId: string
}

/**
 * Deletes a group together with its memberships and every grant that names
 * it; answers how many of each went. Refused with `409 group_has_children`
 * while other groups nest under it.
 */
export function useDeleteGroup() {
  const client = useApiClient()
  const invalidate = useInvalidateGroups()
  return useMutation({
    mutationFn: ({ groupId }: DeleteGroupInput) =>
      request<{ readonly members: number; readonly grants: number }>(
        client.DELETE('/api/groups/{id}', { params: { path: { id: groupId } } }),
      ),
    onSuccess: invalidate,
  })
}

export interface GroupMemberInput {
  readonly groupId: string
  readonly userId: string
}

export function useAddGroupMember() {
  const client = useApiClient()
  const invalidate = useInvalidateGroups()
  return useMutation({
    mutationFn: ({ groupId, userId }: GroupMemberInput) =>
      request<void>(
        client.PUT('/api/groups/{id}/members/{userId}', {
          params: { path: { id: groupId, userId } },
        }),
      ),
    onSuccess: invalidate,
  })
}

export function useRemoveGroupMember() {
  const client = useApiClient()
  const invalidate = useInvalidateGroups()
  return useMutation({
    mutationFn: ({ groupId, userId }: GroupMemberInput) =>
      request<void>(
        client.DELETE('/api/groups/{id}/members/{userId}', {
          params: { path: { id: groupId, userId } },
        }),
      ),
    onSuccess: invalidate,
  })
}
