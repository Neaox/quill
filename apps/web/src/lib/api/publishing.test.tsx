import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRenderedDocument } from './content.ts'
import { ApiError } from './errors.ts'
import { createHookWrapper } from './hook-wrapper.tsx'
import { usePublishDocument, useRestoreRevision } from './publishing.ts'
import { errorResponse, jsonResponse } from './testing.ts'

const PUBLISHED = {
  kind: 'published',
  revision: 'b'.repeat(40),
  warnings: [],
  frontMatterIssues: [],
  incompleteRequiredSections: [],
}

const MERGE_REQUIRED = {
  kind: 'merge-required',
  current: 'c'.repeat(40),
  conflicts: [
    {
      documentId: 'doc-1',
      path: 'runbooks/failover.md',
      base: 'the original line',
      ours: 'what we wrote',
      theirs: 'what they published',
      conflicted: '<<<<<<< ours\nwhat we wrote\n=======\nwhat they published\n>>>>>>> theirs',
    },
  ],
}

describe('usePublishDocument', () => {
  it('publishes the draft against the revision it was based on', async () => {
    const bodies: Array<{ base: string | null }> = []
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/publish': async (request) => {
        bodies.push((await request.json()) as { base: string | null })
        return jsonResponse(200, PUBLISHED)
      },
    })

    const { result } = renderHook(() => usePublishDocument(), { wrapper })
    const outcome = await result.current.mutateAsync({
      documentId: 'doc-1',
      base: 'a'.repeat(40),
      changeNote: 'Tightened the failover steps',
    })

    expect(outcome).toEqual(PUBLISHED)
    expect(bodies).toEqual([{ base: 'a'.repeat(40), changeNote: 'Tightened the failover steps' }])
  })

  it('returns a merge conflict as an outcome rather than throwing it', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/publish': () => jsonResponse(409, MERGE_REQUIRED),
    })

    const { result } = renderHook(() => usePublishDocument(), { wrapper })
    const outcome = await result.current.mutateAsync({ documentId: 'doc-1', base: 'a'.repeat(40) })

    // The three texts a person needs to decide arrive intact.
    expect(outcome.kind).toBe('merge-required')
    expect(outcome).toEqual(MERGE_REQUIRED)
  })

  it('still throws for a 409 that is not a merge', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/publish': () =>
        errorResponse(409, 'parent_not_found', 'Something else entirely'),
    })

    const { result } = renderHook(() => usePublishDocument(), { wrapper })

    await expect(
      result.current.mutateAsync({ documentId: 'doc-1', base: null }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('throws a typed error when publishing is refused', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/publish': () =>
        errorResponse(403, 'forbidden', 'You cannot publish this document'),
    })

    const { result } = renderHook(() => usePublishDocument(), { wrapper })

    await expect(
      result.current.mutateAsync({ documentId: 'doc-1', base: null }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})

describe('useRestoreRevision', () => {
  it('publishes a new revision equal to the named older one', async () => {
    const bodies: Array<{ revision: string }> = []
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/restore': async (request) => {
        bodies.push((await request.json()) as { revision: string })
        return jsonResponse(200, PUBLISHED)
      },
    })

    const { result } = renderHook(() => useRestoreRevision(), { wrapper })
    const outcome = await result.current.mutateAsync({
      documentId: 'doc-1',
      revision: 'a'.repeat(40),
      changeNote: 'Restored v1',
    })

    expect(outcome).toEqual(PUBLISHED)
    expect(bodies).toEqual([{ revision: 'a'.repeat(40), changeNote: 'Restored v1' }])
  })

  it('reports a revision that does not belong to this document', async () => {
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/restore': () =>
        errorResponse(404, 'not_found', 'That revision does not exist for this document'),
    })

    const { result } = renderHook(() => useRestoreRevision(), { wrapper })

    await expect(
      result.current.mutateAsync({ documentId: 'doc-1', revision: 'z'.repeat(40) }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('invalidation after a publish', () => {
  it('drops everything derived from the head so the reader shows the new revision', async () => {
    const requested: string[] = []
    const wrapper = createHookWrapper({
      'POST /api/documents/{id}/publish': () => jsonResponse(200, PUBLISHED),
      'GET /api/documents/{id}/rendered': (request) => {
        requested.push(new URL(request.url).pathname)
        return jsonResponse(200, { revision: 'a'.repeat(40), html: '', outline: [], slots: [] })
      },
    })

    const { result } = renderHook(
      () => ({
        publish: usePublishDocument(),
        rendered: useRenderedDocument('doc-1'),
      }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.rendered.isSuccess).toBe(true)
    })
    expect(requested).toHaveLength(1)

    await result.current.publish.mutateAsync({ documentId: 'doc-1', base: 'a'.repeat(40) })

    await waitFor(() => {
      expect(requested.length).toBeGreaterThan(1)
    })
  })
})
