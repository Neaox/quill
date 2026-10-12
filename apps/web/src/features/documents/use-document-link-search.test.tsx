import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiClientProvider } from '../../lib/api/client-context.tsx'
import { createQueryClient } from '../../lib/api/query-client.ts'
import { createFakeApiClient, jsonResponse } from '../../lib/api/testing.ts'
import { linkTargets, useDocumentLinkSearch } from './use-document-link-search.ts'

function hit(documentId: string, title: string, breadcrumb: string[] = []) {
  return {
    documentId,
    shortId: documentId,
    slug: title.toLowerCase(),
    title,
    path: `/${title}`,
    workspaceId: 'engineering',
    breadcrumb,
    snippet: { text: '', ranges: [] },
    score: 1,
  }
}

const RESULTS = {
  query: 'run',
  current: [hit('doc-1', 'Runbook', ['Runbooks']), hit('doc-2', 'Run log')],
  elsewhere: [
    {
      workspace: { id: 'ops', slug: 'ops', name: 'Operations' },
      hits: [hit('doc-3', 'Run sheet', ['Shifts'])],
    },
  ],
}

describe('the editor’s document link search', () => {
  it('lists this workspace’s matches first, each saying where it lives', () => {
    expect(linkTargets(RESULTS)).toEqual([
      { id: 'doc-1', title: 'Runbook', context: 'Runbooks' },
      { id: 'doc-2', title: 'Run log' },
      { id: 'doc-3', title: 'Run sheet', context: 'Operations / Shifts' },
    ])
  })

  it('asks the search route, from the workspace being written in', async () => {
    const search = vi.fn<(request: Request) => Response>((request) => {
      const url = new URL(request.url)
      expect(url.searchParams.get('q')).toBe('run')
      expect(url.searchParams.get('workspace')).toBe('engineering')
      return jsonResponse(200, RESULTS)
    })
    const client = createFakeApiClient({ 'GET /api/search': search })
    const queryClient = createQueryClient({ onUnauthorized: () => {} })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiClientProvider client={client}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiClientProvider>
    )
    const { result } = renderHook(() => useDocumentLinkSearch('engineering'), { wrapper })
    const signal = new AbortController().signal

    expect(await result.current('run', signal)).toHaveLength(3)
    expect(search).toHaveBeenCalledTimes(1)
    expect(await result.current('  ', signal)).toEqual([])
    expect(await result.current('x'.repeat(600), signal)).toEqual([])
    expect(search).toHaveBeenCalledTimes(1)
  })
})
