import { useQuery } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'

/** The two artifacts a reference index is built from (ADR-065). */
export type ReferenceKind = 'code' | 'schema'

export interface ReferenceSnapshotDto {
  readonly id: string
  readonly kind: ReferenceKind
  readonly sourceCommit: string
  readonly capturedAt: string
  readonly artifactVersion: number
  readonly artifactSize: number
  readonly symbolCount: number
  readonly tableCount: number
  readonly artifactUrl: string
}

export interface ReferenceDto {
  readonly latest: ReferenceSnapshotDto | null
  readonly history: readonly ReferenceSnapshotDto[]
}

/** What the artifact holds is the artifact's own versioned shape; the page narrows it. */
export type ReferenceArtifact = unknown

export function referenceQueryOptions(client: ApiClient, workspaceId: string, kind: ReferenceKind) {
  return {
    queryKey: queryKeys.reference(workspaceId, kind),
    queryFn: () =>
      request<ReferenceDto>(
        client.GET('/api/workspaces/{id}/reference/{kind}', {
          params: { path: { id: workspaceId, kind } },
        }),
      ),
  }
}

export function useReference(workspaceId: string | undefined, kind: ReferenceKind) {
  const client = useApiClient()
  return useQuery({
    ...referenceQueryOptions(client, workspaceId ?? '', kind),
    enabled: workspaceId !== undefined,
  })
}

export function referenceArtifactQueryOptions(
  client: ApiClient,
  workspaceId: string,
  kind: ReferenceKind,
  snapshotId: string,
) {
  return {
    queryKey: queryKeys.referenceArtifact(workspaceId, kind, snapshotId),
    queryFn: () =>
      request<ReferenceArtifact>(
        client.GET('/api/workspaces/{id}/reference/{kind}/artifact', {
          params: { path: { id: workspaceId, kind }, query: { snapshot: snapshotId } },
        }),
      ),
    // A snapshot is immutable: the bytes behind an id never change.
    staleTime: Number.POSITIVE_INFINITY,
  }
}

export function useReferenceArtifact(
  workspaceId: string,
  kind: ReferenceKind,
  snapshotId: string | undefined,
  enabled: boolean,
) {
  const client = useApiClient()
  return useQuery({
    ...referenceArtifactQueryOptions(client, workspaceId, kind, snapshotId ?? ''),
    enabled: enabled && snapshotId !== undefined,
  })
}
