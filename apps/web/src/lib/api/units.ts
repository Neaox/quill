import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type { UnitDto } from './types.ts'

/**
 * Organisational units directly under `parentId` (top-level when omitted).
 * Instance-admin only on the server (`apps/server/src/routes/units.ts`); a
 * non-admin's query settles into its error state with a `403 forbidden`
 * `ApiError`.
 *
 * The options factory is shared with `app/routes/admin.tsx`'s loader, so the
 * route and the component read one cache entry rather than racing two
 * requests for the same list.
 */
export function unitsQueryOptions(client: ApiClient, parentId?: string) {
  return {
    queryKey: queryKeys.units(parentId),
    queryFn: () =>
      request<readonly UnitDto[]>(
        client.GET('/api/units', {
          params: { query: parentId === undefined ? {} : { parentId } },
        }),
      ),
  }
}

export function useUnits(parentId?: string) {
  const client = useApiClient()
  return useQuery(unitsQueryOptions(client, parentId))
}

/**
 * Invalidates the lists a unit write can have changed: the children of its
 * parent, and — because a unit's own children list is keyed separately — the
 * whole `units` prefix. The unit tree is a handful of rows at M2's scale, so
 * refetching the branch is cheaper than reasoning about which entries moved.
 */
function useInvalidateUnits() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['units'] })
  }
}

export interface CreateUnitInput {
  readonly name: string
  /** Omitted for a unit directly under the instance root. */
  readonly parentId?: string
  /** The organisation's own word for this level ("company", "team"); defaults to "unit". */
  readonly label?: string
}

/**
 * Creates a unit: `POST /api/units`. The slug is derived from the name by the
 * server, and `parentId` is *omitted* rather than sent as `null` for a
 * top-level unit — Ajv coerces a `null` to `""` before the null branch of a
 * `string | null` union is tried, which the route's own comment spells out.
 */
export function useCreateUnit() {
  const client = useApiClient()
  const invalidate = useInvalidateUnits()
  return useMutation({
    mutationFn: ({ name, parentId, label }: CreateUnitInput) =>
      request<UnitDto>(
        client.POST('/api/units', {
          body: {
            name,
            ...(parentId === undefined ? {} : { parentId }),
            ...(label === undefined ? {} : { label }),
          },
        }),
      ),
    onSuccess: invalidate,
  })
}

export interface RenameUnitInput {
  readonly unitId: string
  readonly name: string
}

export function useRenameUnit() {
  const client = useApiClient()
  const invalidate = useInvalidateUnits()
  return useMutation({
    mutationFn: ({ unitId, name }: RenameUnitInput) =>
      request<UnitDto>(
        client.PATCH('/api/units/{id}', { params: { path: { id: unitId } }, body: { name } }),
      ),
    onSuccess: invalidate,
  })
}

/**
 * Deletes an empty unit: `DELETE /api/units/:id`, answering `204`.
 *
 * A unit that still holds workspaces or child units is refused with `409
 * unit_not_empty` and `details.{workspaces,units}` counts, because
 * `organisational_units.parent_id` and `workspaces.unit_id` cascade — the
 * caller empties it deliberately first. The mutation does not swallow that:
 * `DeleteUnitDialog` reads the reason off the `ApiError` and shows it.
 */
export function useDeleteUnit() {
  const client = useApiClient()
  const invalidate = useInvalidateUnits()
  return useMutation({
    mutationFn: (unitId: string) =>
      request<void>(client.DELETE('/api/units/{id}', { params: { path: { id: unitId } } })),
    onSuccess: invalidate,
  })
}

/** `409 unit_not_empty`'s `details`: what is still inside, so the reason can be said in words. */
export interface UnitNotEmptyDetails {
  readonly workspaces: number
  readonly units: number
}

export function readUnitNotEmptyDetails(details: unknown): UnitNotEmptyDetails | undefined {
  if (typeof details !== 'object' || details === null) return undefined
  if (!('workspaces' in details) || !('units' in details)) return undefined
  const { workspaces, units } = details
  if (typeof workspaces !== 'number' || typeof units !== 'number') return undefined
  return { workspaces, units }
}
