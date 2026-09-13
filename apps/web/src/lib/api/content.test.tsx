import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  useDocumentEnvelope,
  useDocumentHistory,
  usePublishedContent,
  useRenderedDocument,
  useRevisionDiff,
} from './content.ts'
import { ApiError } from './errors.ts'
import { createHookWrapper } from './hook-wrapper.tsx'
import { errorResponse, jsonResponse } from './testing.ts'

const ETAG = '"abc123-1"'

const BODY = {
  revision: 'a'.repeat(40),
  html: '<article><h1 id="runbook">Runbook</h1></article>',
  outline: [{ id: 'runbook', depth: 1, text: 'Runbook', children: [] }],
  slots: [],
}

describe('useRenderedDocument', () => {
  it('reads the body and keeps the render cache’s ETag with it', async () => {
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/rendered': () =>
        new Response(JSON.stringify(BODY), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: ETAG },
        }),
    })

    const { result } = renderHook(() => useRenderedDocument('doc-1'), { wrapper })

    await waitFor(() => {
      expect(result.current.data).toEqual({ body: BODY, etag: ETAG })
    })
  })

  it('revalidates with If-None-Match and keeps the cached body on a 304 (ADR-031)', async () => {
    const conditionalRequests: Array<string | null> = []
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/rendered': (request) => {
        const validator = request.headers.get('if-none-match')
        conditionalRequests.push(validator)
        if (validator === ETAG) return new Response(null, { status: 304 })
        return new Response(JSON.stringify(BODY), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: ETAG },
        })
      },
    })

    const { result } = renderHook(() => useRenderedDocument('doc-1'), { wrapper })
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    const first = result.current.data

    await result.current.refetch()

    // The first request carried no validator and the second carried the tag
    // the first came back with; the body is the *same object*, so nothing
    // downstream re-renders or re-highlights.
    expect(conditionalRequests).toEqual([null, ETAG])
    expect(result.current.data).toBe(first)
  })

  it('surfaces "never published" as a typed 404 the reader can branch on', async () => {
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/rendered': () =>
        errorResponse(404, 'not_found', 'This document has no published revision'),
    })

    const { result } = renderHook(() => useRenderedDocument('doc-1'), { wrapper })

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(ApiError)
    })
    expect((result.current.error as ApiError).status).toBe(404)
  })

  it('asks for a named revision rather than the head when given one', async () => {
    const asked: Array<string | null> = []
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/rendered': (request) => {
        asked.push(new URL(request.url).searchParams.get('revision'))
        return jsonResponse(200, BODY)
      },
    })

    const { result } = renderHook(() => useRenderedDocument('doc-1', 'b'.repeat(40)), { wrapper })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(asked).toEqual(['b'.repeat(40)])
  })
})

describe('useDocumentEnvelope', () => {
  it('reads the live envelope', async () => {
    const envelope = {
      permissions: { view: true, comment: true, edit: true, manage: false },
      lock: null,
      lastPublished: { revision: 'a'.repeat(40), author: 'Ada', at: '2026-02-03T00:00:00.000Z' },
      review: null,
      health: [{ kind: 'no-owner' }],
    }
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/envelope': () => jsonResponse(200, envelope),
    })

    const { result } = renderHook(() => useDocumentEnvelope('doc-1'), { wrapper })

    await waitFor(() => {
      expect(result.current.data).toEqual(envelope)
    })
  })
})

describe('useDocumentHistory', () => {
  it('reads the revision list', async () => {
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/history': () => jsonResponse(200, { revisions: [] }),
    })

    const { result } = renderHook(() => useDocumentHistory('doc-1'), { wrapper })

    await waitFor(() => {
      expect(result.current.data).toEqual({ revisions: [] })
    })
  })

  it('does not ask at all when it is disabled', async () => {
    let calls = 0
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/history': () => {
        calls += 1
        return jsonResponse(200, { revisions: [] })
      },
    })

    const { result } = renderHook(() => useDocumentHistory('doc-1', { enabled: false }), {
      wrapper,
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(calls).toBe(0)
  })
})

describe('useRevisionDiff', () => {
  it('asks for both ends of the comparison', async () => {
    const asked: Array<Record<string, string>> = []
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/diff': (request) => {
        asked.push(Object.fromEntries(new URL(request.url).searchParams))
        return jsonResponse(200, { from: 'a', to: 'b', unified: '', added: 0, removed: 0 })
      },
    })

    const { result } = renderHook(
      () => useRevisionDiff('doc-1', { from: 'a'.repeat(40), to: 'b'.repeat(40) }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(asked).toEqual([{ from: 'a'.repeat(40), to: 'b'.repeat(40) }])
  })

  it('omits `from` so the server compares against the empty document', async () => {
    const asked: Array<Record<string, string>> = []
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/diff': (request) => {
        asked.push(Object.fromEntries(new URL(request.url).searchParams))
        return jsonResponse(200, { from: null, to: 'b', unified: '', added: 0, removed: 0 })
      },
    })

    const { result } = renderHook(
      () => useRevisionDiff('doc-1', { from: null, to: 'b'.repeat(40) }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(asked).toEqual([{ to: 'b'.repeat(40) }])
  })

  it('waits until there is something to compare', () => {
    const wrapper = createHookWrapper({})

    const { result } = renderHook(() => useRevisionDiff('doc-1', undefined), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('usePublishedContent', () => {
  it('reads a published document’s Markdown and front matter', async () => {
    const wrapper = createHookWrapper({
      'GET /api/documents/{id}/content': () =>
        jsonResponse(200, {
          revision: 'a'.repeat(40),
          markdown: '# Template',
          frontMatter: { template: { name: 'ADR' } },
        }),
    })

    const { result } = renderHook(() => usePublishedContent('doc-1'), { wrapper })

    await waitFor(() => {
      expect(result.current.data?.frontMatter).toEqual({ template: { name: 'ADR' } })
    })
  })

  it('waits until a template has been chosen', () => {
    const { result } = renderHook(() => usePublishedContent(undefined), {
      wrapper: createHookWrapper({}),
    })

    expect(result.current.fetchStatus).toBe('idle')
  })
})
