import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createHookWrapper } from './hook-wrapper.tsx'
import { jsonResponse } from './testing.ts'
import {
  TREE_PAGE_SIZE,
  treeChildrenQueryOptions,
  useTreeCollections,
  useTreePosition,
} from './tree.ts'
import { useApiClient } from './client-context.tsx'
import { useQuery } from '@tanstack/react-query'

describe('the navigation tree’s queries', () => {
  it('asks for the collections of a workspace', async () => {
    const wrapper = createHookWrapper({
      'GET /api/workspaces/{id}/collections': () =>
        jsonResponse(200, [{ id: 'c1', name: 'Guides', slug: 'guides' }]),
    })

    const { result } = renderHook(() => useTreeCollections('workspace-1'), { wrapper })

    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: 'c1', name: 'Guides', slug: 'guides' }])
    })
  })

  it('asks for nothing until it knows the workspace', () => {
    const wrapper = createHookWrapper({})

    const { result } = renderHook(() => useTreeCollections(undefined), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
  })

  it('asks for one page of one parent’s children, from where the last ended', async () => {
    const asked: string[] = []
    const wrapper = createHookWrapper({
      'GET /api/workspaces/{id}/tree/children': (request) => {
        asked.push(new URL(request.url).search)
        return jsonResponse(200, { nodes: [] })
      },
    })

    const { result } = renderHook(
      () => {
        const client = useApiClient()
        return useQuery(
          treeChildrenQueryOptions(
            client,
            'workspace-1',
            { collectionId: 'c1', parentId: 'd1' },
            'p2',
          ),
        )
      },
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.data).toEqual({ nodes: [] })
    })
    expect(new URLSearchParams(asked[0]).toString()).toBe(
      new URLSearchParams({
        collectionId: 'c1',
        parentId: 'd1',
        cursor: 'p2',
        limit: String(TREE_PAGE_SIZE),
      }).toString(),
    )
  })

  it('asks where a document is in the tree', async () => {
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/tree-position': () =>
        jsonResponse(200, { collectionId: 'c1', ancestors: ['d1'], childCount: 2 }),
    })

    const { result } = renderHook(() => useTreePosition('d2'), { wrapper })

    await waitFor(() => {
      expect(result.current.data).toEqual({ collectionId: 'c1', ancestors: ['d1'], childCount: 2 })
    })
  })
})
