import { createContext, useContext, type ReactNode } from 'react'

import type { ApiClient } from '@quill/api-client'

const ApiClientContext = createContext<ApiClient | null>(null)

export interface ApiClientProviderProps {
  /** Built once with `createApiClient()`; tests build one with a fake `fetch` instead. */
  readonly client: ApiClient
  readonly children: ReactNode
}

/**
 * Puts the single `ApiClient` instance (ADR-013: "the web app talks to the
 * server only through the generated OpenAPI client") on context, so every
 * hook in `src/lib/api` reads it with `useApiClient` instead of importing a
 * module-level singleton — which is what makes injecting a fake `fetch` in
 * component tests possible without any network mocking library.
 */
export function ApiClientProvider({ client, children }: ApiClientProviderProps) {
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext)
  if (client === null) {
    throw new Error('useApiClient must be used within an ApiClientProvider')
  }
  return client
}
