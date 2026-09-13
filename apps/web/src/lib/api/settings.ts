import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'

import type { ApiClient } from '@quill/api-client'

import { useApiClient } from './client-context.tsx'
import { ApiError } from './errors.ts'
import { request } from './http.ts'
import { queryKeys } from './query-keys.ts'
import type {
  OrganisationSettings,
  OrganisationSettingsResponse,
  SavedOrganisationSettings,
  SecretDto,
  WorkspaceSettingsDocument,
  WorkspaceSettingsResponse,
} from './types.ts'

/**
 * Settings and secrets (ADR-034, `docs/architecture/api-contract-settings.md`).
 *
 * Three things about this module are properties of the contract rather than
 * choices made here:
 *
 * 1. **Every write states the revision it was based on.** The server recovers
 *    the file's bytes at that revision and uses them as the expected value of
 *    a compare-and-swap, so a concurrent change is refused (`409
 *    settings_conflict`) and never merged. The revision therefore travels
 *    with the settings everywhere, and a form keeps the one it loaded.
 * 2. **A successful write answers with the new state and its new revision**,
 *    so the mutation writes that straight into the cache rather than
 *    invalidating and re-fetching: the form that just saved has the revision
 *    its next save needs without a round trip it could lose a race to.
 * 3. **No response carries a secret's value**, which is why `SecretDto` has no
 *    field for one and nothing here asks for one back.
 */

/**
 * `staleTime` is deliberate, and is **not** what makes a concurrent save safe
 * — the revision a form saves with lives in its draft, which is what closes
 * that (`use-settings-draft.ts`). It is here because this entry is read by
 * every signed-in screen for the organisation's name, and an identity that
 * changes a few times a year has no business refetching every time a window
 * regains focus.
 */
const SETTINGS_STALE_TIME_MS = 5 * 60 * 1000

export function organisationSettingsQueryOptions(client: ApiClient) {
  return {
    queryKey: queryKeys.organisationSettings(),
    queryFn: () => request(client.GET('/api/settings/organisation', {})),
    staleTime: SETTINGS_STALE_TIME_MS,
  }
}

export function useOrganisationSettings() {
  const client = useApiClient()
  return useQuery(organisationSettingsQueryOptions(client))
}

/**
 * The organisation's settings a route's loader has already awaited.
 *
 * `useSuspenseQuery`, like `useLoadedWorkspace`: the entry is in the cache
 * before the component renders, so there is no pending branch here pretending
 * to be a state — and a failure, which for these routes means the settings
 * file this release cannot read, reaches the route's `errorComponent` with
 * the revision it needs to offer the repair.
 */
export function useLoadedOrganisationSettings() {
  const client = useApiClient()
  return useSuspenseQuery(organisationSettingsQueryOptions(client))
}

export interface SaveOrganisationSettingsInput {
  readonly settings: OrganisationSettings
  /** The revision the form was loaded at; `null` means "I read nothing". */
  readonly expectedRevision: string | null
  /** What the revision says it was for. Optional, and omitted rather than empty. */
  readonly changeNote?: string
}

/**
 * `PUT /settings/organisation`.
 *
 * The response is written into the cache as the new truth, which is what
 * keeps a form's revision current across repeated saves. A `409` leaves the
 * cache alone and *invalidates* instead: the conflict means the entry is
 * stale, and the screen's conflict state needs the values that are actually
 * on the server to show them beside the ones being edited.
 */
export function useSaveOrganisationSettings() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ settings, expectedRevision, changeNote }: SaveOrganisationSettingsInput) =>
      request(
        client.PUT('/api/settings/organisation', {
          body: {
            settings,
            expectedRevision,
            ...(changeNote === undefined || changeNote === '' ? {} : { changeNote }),
          },
        }),
      ),
    onSuccess: (saved: SavedOrganisationSettings) => {
      queryClient.setQueryData(queryKeys.organisationSettings(), {
        revision: saved.revision,
        settings: saved.settings,
      } satisfies OrganisationSettingsResponse)
    },
    onError: (error: unknown) => {
      if (isSettingsConflict(error)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.organisationSettings() })
      }
    },
  })
}

export function workspaceSettingsQueryOptions(client: ApiClient, idOrSlug: string) {
  return {
    queryKey: queryKeys.workspaceSettings(idOrSlug),
    queryFn: () =>
      request(client.GET('/api/workspaces/{id}/settings', { params: { path: { id: idOrSlug } } })),
    staleTime: SETTINGS_STALE_TIME_MS,
  }
}

/** A workspace's settings a route's loader has already awaited. */
export function useLoadedWorkspaceSettings(idOrSlug: string) {
  const client = useApiClient()
  return useSuspenseQuery(workspaceSettingsQueryOptions(client, idOrSlug))
}

export interface SaveWorkspaceSettingsInput {
  readonly settings: WorkspaceSettingsDocument
  readonly expectedRevision: string | null
  readonly changeNote?: string
}

/**
 * `PUT /workspaces/:idOrSlug/settings`.
 *
 * Two refusals are expected rather than exceptional and are left for the
 * screen to say in words: `409 settings_conflict`, and `409
 * workspace_layout_locked` when the organisation decides the layout for every
 * workspace. Both invalidate, because both mean this entry no longer
 * describes the server — the lock may have been turned on since the page
 * loaded, and `effective.layoutLocked` is what the screen renders from.
 */
export function useSaveWorkspaceSettings(idOrSlug: string) {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ settings, expectedRevision, changeNote }: SaveWorkspaceSettingsInput) =>
      request(
        client.PUT('/api/workspaces/{id}/settings', {
          params: { path: { id: idOrSlug } },
          body: {
            settings,
            expectedRevision,
            ...(changeNote === undefined || changeNote === '' ? {} : { changeNote }),
          },
        }),
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(
        queryKeys.workspaceSettings(idOrSlug),
        (previous: WorkspaceSettingsResponse | undefined) =>
          previous === undefined
            ? undefined
            : { ...previous, revision: saved.revision, settings: saved.settings },
      )
    },
    onError: (error: unknown) => {
      if (isSettingsConflict(error) || isLayoutLocked(error)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceSettings(idOrSlug) })
      }
    },
  })
}

export function secretsQueryOptions(client: ApiClient) {
  return {
    queryKey: queryKeys.secrets(),
    queryFn: () => request(client.GET('/api/settings/secrets', {})),
  }
}

export function useSecrets() {
  const client = useApiClient()
  return useQuery(secretsQueryOptions(client))
}

export interface SetSecretInput {
  readonly name: string
  readonly value: string
}

/**
 * `PUT /settings/secrets/:name`: store or replace a value.
 *
 * The response is the secret's *metadata* — name, key id, dates — and never
 * the value, so the list is invalidated from it rather than patched with
 * something that could be mistaken for one.
 */
export function useSetSecret() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    /*
     * The plaintext value is a mutation *variable*, and TanStack Query keeps a
     * settled mutation — variables included — in the `MutationCache` for
     * `gcTime` after its observer unmounts, which here is the moment the
     * dialog closes. Five minutes of a client secret sitting in process memory,
     * readable from the devtools and captured by anything that serialises
     * cache state, is not what "write-only" means. Zero drops it as soon as
     * the request settles; the screen calls `reset()` as well, so nothing is
     * left even while the dialog is still open.
     */
    gcTime: 0,
    mutationFn: ({ name, value }: SetSecretInput) =>
      request<SecretDto>(
        client.PUT('/api/settings/secrets/{name}', {
          params: { path: { name } },
          body: { value },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.secrets() })
    },
  })
}

/** `DELETE /settings/secrets/:name`, answering `204`. */
export function useDeleteSecret() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      request<void>(client.DELETE('/api/settings/secrets/{name}', { params: { path: { name } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.secrets() })
    },
  })
}

/** Somebody else saved while this form was open. `details.revision` is theirs. */
export function isSettingsConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'settings_conflict'
}

/** The organisation locked layout; this workspace may not override it. */
export function isLayoutLocked(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 409 && error.code === 'workspace_layout_locked'
  )
}

/** One reason a settings document was refused: `422 invalid_settings`'s `details.issues`. */
export interface SettingsIssue {
  readonly path: string
  readonly message: string
  readonly rule: string
}

function isSettingsIssue(issue: unknown): issue is SettingsIssue {
  if (typeof issue !== 'object' || issue === null) return false
  const { path, message, rule } = issue as Partial<SettingsIssue>
  return typeof path === 'string' && typeof message === 'string' && typeof rule === 'string'
}

/**
 * The schema issues behind a `422 invalid_settings`, or an empty list.
 *
 * The server validates the whole document, so a rule the form does not check
 * itself still arrives with a path a person can be pointed at, rather than as
 * a bare "not valid".
 */
export function readSettingsIssues(error: unknown): readonly SettingsIssue[] {
  if (!(error instanceof ApiError) || error.code !== 'invalid_settings') return []
  const details = error.details
  if (typeof details !== 'object' || details === null || !('issues' in details)) return []
  const { issues } = details
  return Array.isArray(issues) ? issues.filter(isSettingsIssue) : []
}

/**
 * The revision of a settings file this release cannot read (`500
 * settings_unreadable`), which the server sends **only to an instance
 * administrator** because it is the one thing needed to act: it is the
 * `expectedRevision` of the `PUT` that overwrites the file.
 *
 * `undefined` for everybody else, and for any other failure, so a screen can
 * ask this question of any error and get an answer it can branch on.
 */
export function readUnreadableRevision(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.code !== 'settings_unreadable') return undefined
  const details = error.details
  if (typeof details !== 'object' || details === null || !('revision' in details)) return undefined
  const { revision } = details
  return typeof revision === 'string' ? revision : undefined
}

/** True for the settings file this release cannot read, whoever is asking. */
export function isSettingsUnreadable(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'settings_unreadable'
}
