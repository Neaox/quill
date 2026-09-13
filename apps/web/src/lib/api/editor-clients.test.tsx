import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DocumentAst } from '@quill/editor'

import { DRAFT_CONTENT_VERSION } from '../documents/draft-content.ts'
import { useDraftClient, useLockClient } from './editor-clients.ts'
import { createHookWrapper } from './hook-wrapper.tsx'
import { errorResponse, jsonResponse, type FakeRoutes } from './testing.ts'

// Typed as the editor's own document tree, which is what a `DraftClient`
// hands back and takes: mdast's `type` is a literal, not a string.
const TREE: DocumentAst = { type: 'root', children: [{ type: 'paragraph', children: [] }] }

const DRAFT = {
  documentId: 'doc-1',
  draftVersion: 3,
  baseRevision: 'a'.repeat(40),
  ast: { version: DRAFT_CONTENT_VERSION, frontMatter: { title: 'Runbook' }, ast: TREE },
  updatedAt: '2026-02-03T00:00:00.000Z',
}

const HOLDER = {
  documentId: 'doc-1',
  holderUserId: 'user-2',
  holderSessionId: 'session-2',
  acquiredAt: '2026-02-03T00:00:00.000Z',
  lastHeartbeatAt: '2026-02-03T00:00:30.000Z',
  expiresAt: '2026-02-03T00:01:00.000Z',
}

function draftClient(routes: FakeRoutes) {
  return renderHook(() => useDraftClient('doc-1'), { wrapper: createHookWrapper(routes) }).result
}

function lockClient(routes: FakeRoutes) {
  return renderHook(() => useLockClient('doc-1'), { wrapper: createHookWrapper(routes) }).result
}

describe('useDraftClient', () => {
  it('loads the tree out of the draft envelope, leaving the envelope behind', async () => {
    const client = draftClient({ 'GET /api/documents/{id}/draft': () => jsonResponse(200, DRAFT) })

    expect(await client.current.load()).toEqual({
      ast: TREE,
      draftVersion: 3,
      baseRevision: 'a'.repeat(40),
    })
  })

  it('refuses a draft written by a newer release rather than opening it half-read', async () => {
    const client = draftClient({
      'GET /api/documents/{id}/draft': () =>
        jsonResponse(200, { ...DRAFT, ast: { version: 99, frontMatter: {}, ast: TREE } }),
    })

    await expect(client.current.load()).rejects.toThrow(/newer version/)
  })

  it('saves the tree back inside the envelope it came in, front matter untouched', async () => {
    const bodies: Array<{ ast: unknown; expectedVersion: number }> = []
    const client = draftClient({
      'GET /api/documents/{id}/draft': () => jsonResponse(200, DRAFT),
      'PUT /api/documents/{id}/draft': async (request) => {
        bodies.push((await request.json()) as { ast: unknown; expectedVersion: number })
        return jsonResponse(200, { draftVersion: 4, updatedAt: '2026-02-03T00:05:00.000Z' })
      },
    })
    await client.current.load()

    const edited: DocumentAst = { type: 'root', children: [] }
    const result = await client.current.save(edited, 3)

    expect(result).toEqual({
      status: 'saved',
      draftVersion: 4,
      updatedAt: Date.parse('2026-02-03T00:05:00.000Z'),
    })
    expect(bodies).toEqual([
      {
        ast: { version: DRAFT_CONTENT_VERSION, frontMatter: { title: 'Runbook' }, ast: edited },
        expectedVersion: 3,
      },
    ])
  })

  // ADR-021's contract table: the client branches on the status code and
  // never on a message, so each one has to arrive as its own result.
  it('maps 423 to lock_lost, with the holder from the error details', async () => {
    const client = draftClient({
      'GET /api/documents/{id}/draft': () => jsonResponse(200, DRAFT),
      'PUT /api/documents/{id}/draft': () =>
        errorResponse(423, 'lock_lost', 'You do not hold a valid lock', { holder: HOLDER }),
    })

    expect(await client.current.save(TREE, 3)).toEqual({
      status: 'lock_lost',
      holder: {
        userId: 'user-2',
        displayName: 'Another editor',
        expiresAt: Date.parse(HOLDER.expiresAt),
      },
    })
  })

  it('maps 409 to stale_version, carrying the version to re-read from', async () => {
    const client = draftClient({
      'GET /api/documents/{id}/draft': () => jsonResponse(200, DRAFT),
      'PUT /api/documents/{id}/draft': () =>
        errorResponse(409, 'stale_version', 'Your draft version is behind', { currentVersion: 7 }),
    })

    expect(await client.current.save(TREE, 3)).toEqual({
      status: 'stale_version',
      currentVersion: 7,
    })
  })

  it('maps 401 to session_expired', async () => {
    const client = draftClient({
      'GET /api/documents/{id}/draft': () => jsonResponse(200, DRAFT),
      'PUT /api/documents/{id}/draft': () =>
        errorResponse(401, 'session_expired', 'Your session has expired'),
    })

    expect(await client.current.save(TREE, 3)).toEqual({ status: 'session_expired' })
  })

  it('rethrows anything the ADR does not describe', async () => {
    const client = draftClient({
      'GET /api/documents/{id}/draft': () => jsonResponse(200, DRAFT),
      'PUT /api/documents/{id}/draft': () => errorResponse(500, 'internal_error', 'Boom'),
    })

    await expect(client.current.save(TREE, 3)).rejects.toMatchObject({ status: 500 })
  })
})

describe('useLockClient', () => {
  it('acquires a lock', async () => {
    const client = lockClient({
      'POST /api/documents/{id}/lock/acquire': () =>
        jsonResponse(200, { lock: { ...HOLDER, holderUserId: 'user-1' } }),
    })

    expect(await client.current.acquire()).toEqual({
      status: 'acquired',
      lock: {
        holderUserId: 'user-1',
        holderSessionId: 'session-2',
        expiresAt: Date.parse(HOLDER.expiresAt),
      },
    })
  })

  it('reports a lock somebody else holds', async () => {
    const client = lockClient({
      'POST /api/documents/{id}/lock/acquire': () =>
        errorResponse(409, 'held', 'This document is locked by another editor', {
          holder: HOLDER,
        }),
    })

    expect(await client.current.acquire()).toMatchObject({
      status: 'held',
      holder: { userId: 'user-2' },
    })
  })

  it.each([
    [200, 'alive'],
    [410, 'expired'],
    [404, 'released'],
    [409, 'taken_over'],
  ])('maps heartbeat %i to %s', async (status, expected) => {
    const client = lockClient({
      'POST /api/documents/{id}/lock/heartbeat': () =>
        status === 200
          ? jsonResponse(200, { expiresAt: HOLDER.expiresAt })
          : errorResponse(status, expected, 'Lock trouble', { holder: HOLDER }),
    })

    expect((await client.current.heartbeat()).status).toBe(expected)
  })

  it('rethrows a heartbeat failure the ADR does not describe', async () => {
    const client = lockClient({
      'POST /api/documents/{id}/lock/heartbeat': () => errorResponse(503, 'unavailable', 'Down'),
    })

    await expect(client.current.heartbeat()).rejects.toMatchObject({ status: 503 })
  })

  it('releases unconditionally', async () => {
    const client = lockClient({
      'DELETE /api/documents/{id}/lock': () => new Response(null, { status: 204 }),
    })

    await expect(client.current.release()).resolves.toBeUndefined()
  })

  it('takes a lock over as an admin, and reports a refusal for anyone else', async () => {
    const admin = lockClient({
      'POST /api/documents/{id}/lock/takeover': () => jsonResponse(200, { lock: HOLDER }),
    })
    expect((await admin.current.takeover()).status).toBe('acquired')

    const editor = lockClient({
      'POST /api/documents/{id}/lock/takeover': () =>
        errorResponse(403, 'forbidden', 'Workspace admin required'),
    })
    expect(await editor.current.takeover()).toEqual({ status: 'forbidden' })
  })

  it('is the same object across renders, so the heartbeat loop is never restarted', () => {
    const { result, rerender } = renderHook(() => useLockClient('doc-1'), {
      wrapper: createHookWrapper({}),
    })
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })
})
