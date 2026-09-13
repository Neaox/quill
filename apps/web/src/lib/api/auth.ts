import type { ApiClient } from '@quill/api-client'
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'

import { useApiClient } from './client-context.tsx'
import { request } from './http.ts'
import { clearSessionState } from './query-client.ts'
import { queryKeys } from './query-keys.ts'
import type { MeResponse, SignInResponse, SignUpResponse } from './types.ts'

/**
 * The query definition behind `useMe`, exported so the authenticated layout
 * route's `beforeLoad` (`app/router.tsx`) can `ensureQueryData` it directly:
 * a router loader runs outside the component tree, so it cannot call a hook,
 * but it can share the exact query a hook would run.
 */
export function meQueryOptions(client: ApiClient): UseQueryOptions<MeResponse> {
  return {
    queryKey: queryKeys.me,
    queryFn: () => request<MeResponse>(client.GET('/api/me', {})),
  }
}

/** The signed-in user, or `undefined` while loading and `null`/error when signed out. */
export function useMe() {
  const client = useApiClient()
  return useQuery(meQueryOptions(client))
}

export interface SignInInput {
  readonly email: string
  readonly password: string
}

export function useSignIn() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SignInInput) =>
      request<SignInResponse>(client.POST('/api/auth/sign-in', { body: input })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}

export interface SignUpInput {
  readonly email: string
  readonly password: string
  readonly displayName: string
}

export function useSignUp() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SignUpInput) =>
      request<SignUpResponse>(client.POST('/api/auth/sign-up', { body: input })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}

export function useSignOut() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => request<void>(client.POST('/api/auth/sign-out', {})),
    onSuccess: () => {
      clearSessionState(queryClient)
    },
  })
}

export interface RequestMagicLinkInput {
  readonly email: string
  /** The public endpoint issues sign-in links only; verification and reset links come from their own flows. */
  readonly purpose?: 'sign-in'
}

export function useRequestMagicLink() {
  const client = useApiClient()
  return useMutation({
    mutationFn: (input: RequestMagicLinkInput) =>
      request<void>(client.POST('/api/auth/magic-link', { body: input })),
  })
}

export function useConsumeMagicLink() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) =>
      request<SignInResponse>(client.POST('/api/auth/magic-link/consume', { body: { token } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}

export function useRequestPasswordReset() {
  const client = useApiClient()
  return useMutation({
    mutationFn: (email: string) =>
      request<void>(client.POST('/api/auth/password-reset/request', { body: { email } })),
  })
}

export interface ConfirmPasswordResetInput {
  readonly token: string
  readonly newPassword: string
}

export function useConfirmPasswordReset() {
  const client = useApiClient()
  return useMutation({
    mutationFn: (input: ConfirmPasswordResetInput) =>
      request<void>(client.POST('/api/auth/password-reset/confirm', { body: input })),
  })
}

export function useVerifyEmail() {
  const client = useApiClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) =>
      request<void>(client.POST('/api/auth/verify-email', { body: { token } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}
