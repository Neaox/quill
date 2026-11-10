import { useEffect, useSyncExternalStore } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import { queryKeys } from './query-keys.ts'

/**
 * A workspace's live stream (ADR-063): the server says when something a page
 * shows has changed, and the page reads it again through the ordinary routes.
 *
 * The stream says *when*, never *what*: each message names at most a
 * document's id. What it does here is mark queries stale, and TanStack Query
 * refetches the ones on screen:
 *
 * - `sync` (a sync started, finished or failed): the source's state, and
 *   whether each open document has moved on. A finished sync that changed
 *   something also refreshes the tree and the document list.
 * - `document` (a page's head moved): whether the open page has moved on,
 *   which is what offers its reader the new version
 *   (`use-source-reload-offer.ts`).
 *   The page on screen is never swapped under its reader.
 * - `tree` (pages were added, renamed, moved or nested): the tree and the list.
 * - `reset` (too much changed to name): all of the above.
 *
 * **Polling stays as the fallback.** While the stream is not open (it has not
 * opened yet, the browser is reconnecting, or the server refused it), the
 * hooks that poll keep their usual pace; while it is open they slow to a
 * backstop (`whileLive`), for a change the stream could not see — one made in
 * another server process (ADR-056).
 */

export type LiveState = 'connecting' | 'open' | 'closed'

const states = new Map<string, LiveState>()
const listeners = new Set<() => void>()

function announceState(workspaceId: string, state: LiveState | null): void {
  if (state === null) states.delete(workspaceId)
  else states.set(workspaceId, state)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Whether a workspace's stream is open now; false for none, or none open. */
export function isLive(workspaceId: string | undefined): boolean {
  return workspaceId !== undefined && states.get(workspaceId) === 'open'
}

/** `isLive`, for a component that should render again when it changes. */
export function useIsLive(workspaceId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => isLive(workspaceId))
}

/**
 * The interval a polling hook asks again at: its own while no stream is open
 * for the workspace, and the backstop while one is.
 */
export function whileLive(
  workspaceId: string | undefined,
  interval: number | false,
  backstop: number,
): number | false {
  if (interval === false) return false
  return isLive(workspaceId) ? Math.max(interval, backstop) : interval
}

/** How long a polling hook waits while the stream is open: what the stream cannot see. */
export const LIVE_BACKSTOP_MS = 60_000

function treeChanged(queryClient: QueryClient, workspaceId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTree(workspaceId) })
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceDocuments(workspaceId) })
}

function readMessage(event: MessageEvent<string>): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(event.data)
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** What each message marks stale; exported for its test. */
export function applyLiveMessage(
  queryClient: QueryClient,
  workspaceId: string,
  name: string,
  data: Record<string, unknown>,
): void {
  // By its prefix: an open page's question is keyed by however its address
  // spelled it (ADR-035), not always by the id a message names, and only the
  // pages on screen are asked again.
  const freshness = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.sourceFreshnessAll() })
  switch (name) {
    case 'sync':
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceSource(workspaceId) })
      freshness()
      if (data['changed'] === true) treeChanged(queryClient, workspaceId)
      return
    case 'document':
      freshness()
      return
    case 'tree':
      treeChanged(queryClient, workspaceId)
      return
    case 'reset':
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceSource(workspaceId) })
      freshness()
      treeChanged(queryClient, workspaceId)
      return
    default:
  }
}

const MESSAGES = ['sync', 'document', 'tree', 'reset'] as const

/**
 * Keeps a workspace's stream open while the component is mounted: the
 * workspace layout, so one stream serves the sidebar, the repository page
 * and an open document. `enabled` is false for a workspace with nothing to
 * stream (one not read from a repository) and in a browser with no
 * `EventSource`, where the hooks simply keep polling.
 */
export function useWorkspaceLive(workspaceId: string, enabled: boolean): void {
  const queryClient = useQueryClient()
  // Synchronises with the server's event stream, an external system: it is
  // opened for the workspace on screen and closed when that changes.
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    const source = new EventSource(`/api/workspaces/${encodeURIComponent(workspaceId)}/events`)
    announceState(workspaceId, 'connecting')
    let opened = false
    source.addEventListener('open', () => {
      announceState(workspaceId, 'open')
      // What changed while the stream was down is read again once it is back up.
      if (opened) applyLiveMessage(queryClient, workspaceId, 'reset', {})
      opened = true
    })
    source.addEventListener('error', () => {
      // The browser reconnects by itself unless the server refused the stream outright.
      announceState(workspaceId, source.readyState === EventSource.CLOSED ? 'closed' : 'connecting')
    })
    for (const name of MESSAGES) {
      source.addEventListener(name, (event: MessageEvent<string>) => {
        applyLiveMessage(queryClient, workspaceId, name, readMessage(event))
      })
    }
    return () => {
      source.close()
      announceState(workspaceId, null)
    }
  }, [enabled, queryClient, workspaceId])
}
