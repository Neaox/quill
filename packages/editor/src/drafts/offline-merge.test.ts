import { act, renderHook } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { contentKey, parseMarkdown, stringifyMdast } from '@quill/markdown'

import type { FakeClock } from './clock.ts'
import { createFakeClock } from './clock.ts'
import type { DocumentAst, DraftClient, LoadedDraft, LockClient } from './clients.ts'
import { createFakeConnectivity } from './connectivity.ts'
import { createMemoryRecoveryStore } from './recovery-store.ts'
import { useAutosave } from './use-autosave.ts'
import { useConnectionStatus } from './use-connection-status.ts'
import { useDocumentLock } from './use-document-lock.ts'
import { useDraftReconciliation } from './use-draft-reconciliation.ts'

/**
 * ADR-021's amendment, end to end in the client: two sessions against one
 * fake server that keeps the lock and the draft by ADR-021's rules (expiry,
 * takeover, version checks), a fake clock, and network partitions that the
 * browser does not report — `navigator.onLine` stays true throughout, as it
 * does behind a captive portal. Every scenario the amendment lists is here.
 */

const EXPIRY_MS = 60_000

const md = (markdown: string): DocumentAst => parseMarkdown(markdown)
const text = (ast: DocumentAst | undefined): string =>
  ast === undefined ? '' : stringifyMdast(ast)

interface Holder {
  readonly session: string
  readonly name: string
  expiresAt: number
}

const holderOf = (held: Holder) => ({
  userId: held.session,
  displayName: held.name,
  expiresAt: held.expiresAt,
})

/** The server: one lock row and one draft row, with ADR-021's rules. */
function createServer(clock: FakeClock, initial: string) {
  let lock: Holder | null = null
  const draft = { ast: md(initial), version: 1, writtenBy: 'nobody' }
  const live = (session: string) =>
    lock !== null && lock.session === session && lock.expiresAt >= clock.now()

  return {
    get draft() {
      return draft
    },
    get holder() {
      return lock?.session ?? null
    },
    /** A client of one session, cut off from the server while `reachable` says so. */
    client(session: string, name: string, reachable: () => boolean): LockClient & DraftClient {
      const unreachable = () => {
        if (!reachable()) throw new TypeError('Failed to fetch')
      }
      return {
        async acquire() {
          unreachable()
          if (lock !== null && lock.session !== session && lock.expiresAt >= clock.now()) {
            return { status: 'held', holder: holderOf(lock) }
          }
          lock = { session, name, expiresAt: clock.now() + EXPIRY_MS }
          return {
            status: 'acquired',
            lock: { holderUserId: session, holderSessionId: session, expiresAt: lock.expiresAt },
          }
        },
        async heartbeat() {
          unreachable()
          if (lock === null) return { status: 'released' }
          if (lock.session !== session) return { status: 'taken_over', holder: holderOf(lock) }
          if (lock.expiresAt < clock.now()) return { status: 'expired' }
          lock.expiresAt = clock.now() + EXPIRY_MS
          return { status: 'alive', expiresAt: lock.expiresAt }
        },
        async release() {
          if (reachable() && lock?.session === session) lock = null
        },
        async takeover() {
          unreachable()
          lock = { session, name, expiresAt: clock.now() + EXPIRY_MS }
          return {
            status: 'acquired',
            lock: { holderUserId: session, holderSessionId: session, expiresAt: lock.expiresAt },
          }
        },
        async load(): Promise<LoadedDraft> {
          unreachable()
          return {
            ast: draft.ast,
            draftVersion: draft.version,
            baseRevision: null,
            writtenBy: { userId: draft.writtenBy, displayName: draft.writtenBy },
          }
        },
        async save(ast, expectedVersion) {
          if (!reachable()) return { status: 'unavailable', retryAfterMs: null }
          if (!live(session))
            return { status: 'lock_lost', holder: lock === null ? null : holderOf(lock) }
          if (expectedVersion !== draft.version) {
            return { status: 'stale_version', currentVersion: draft.version }
          }
          draft.ast = ast
          draft.version += 1
          draft.writtenBy = name
          return { status: 'saved', draftVersion: draft.version, updatedAt: clock.now() }
        },
      }
    },
  }
}

type Server = ReturnType<typeof createServer>

/** One editing session: what the route wires together, without the editor. */
function openSession(server: Server, clock: FakeClock, session: string, name: string) {
  let online = true
  const client = server.client(session, name, () => online)
  const store = createMemoryRecoveryStore()
  const connectivity = createFakeConnectivity()
  const merged: string[] = []
  const loaded = { ast: server.draft.ast, version: server.draft.version }

  const view = renderHook(() => {
    const lock = useDocumentLock({ client, clock, connectivity, random: () => 0.5 })
    const autosave = useAutosave({
      client,
      store,
      documentVersion: loaded.version,
      documentAst: loaded.ast,
      canSave: lock.canAutosave,
      clock,
      connectivity,
      random: () => 0.5,
    })
    const [content, setContent] = useState(loaded.ast)
    const reconcile = useDraftReconciliation({
      lock,
      autosave,
      client,
      store,
      clock,
      onReplace: setContent,
      onMerged: (theirs) => {
        merged.push(theirs.writtenBy?.displayName ?? '')
      },
    })
    const connection = useConnectionStatus({ autosave: autosave.status, lock: lock.status, clock })
    const [acquire] = useState(() => lock.acquire)
    // Takes the lock on the (fake) server once on open, as the route does.
    useEffect(() => {
      void acquire()
    }, [acquire])
    return { lock, autosave, reconcile, connection, content }
  })

  return {
    view,
    store,
    merged,
    get current() {
      return view.result.current
    },
    /** What the author typed: the editor shows it and hands it to autosave. */
    type(markdown: string) {
      act(() => {
        view.result.current.autosave.change(md(markdown))
      })
    },
    cutOff() {
      online = false
    },
    reconnect() {
      online = true
    },
  }
}

/** Moves time on in small steps, letting every request and render settle. */
async function wait(clock: FakeClock, ms: number, step = 500): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await act(async () => {
      clock.advance(Math.min(step, ms - elapsed))
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
    })
  }
}

const BASE = '# Runbook\n\nMove traffic east.\n\nPage the on-call.\n'

describe('offline without noticing, and merging drafts (ADR-021 amendment)', () => {
  it('keeps typing local through a disconnection the browser does not report, and says so', async () => {
    const clock = createFakeClock(0)
    const server = createServer(clock, BASE)
    const alex = openSession(server, clock, 'alex', 'Alex')
    await wait(clock, 1000)
    expect(alex.current.lock.status).toBe('held')

    alex.cutOff()
    alex.type('# Runbook\n\nMove traffic east, then west.\n\nPage the on-call.\n')
    await wait(clock, 20_000)

    expect(alex.current.connection.offline).toBe(true)
    expect(alex.current.connection.othersMayEdit).toBe(false)
    expect(text(alex.store.read()?.ast)).toContain('then west')

    await wait(clock, 45_000)
    expect(alex.current.connection.othersMayEdit).toBe(true)
  })

  it('saves on reconnecting when nobody else wrote, merging nothing', async () => {
    const clock = createFakeClock(0)
    const server = createServer(clock, BASE)
    const alex = openSession(server, clock, 'alex', 'Alex')
    await wait(clock, 1000)

    alex.cutOff()
    alex.type('# Runbook\n\nMove traffic east, then west.\n\nPage the on-call.\n')
    // Long enough for the lock to lapse, with nobody taking it.
    await wait(clock, 90_000)
    alex.reconnect()
    await wait(clock, 40_000)

    expect(text(server.draft.ast)).toContain('then west')
    expect(alex.current.connection.offline).toBe(false)
    expect(alex.current.autosave.status).toBe('saved')
    expect(alex.merged).toEqual([])
  })

  it('merges edits to different blocks when the lock was taken and freed while offline', async () => {
    const clock = createFakeClock(0)
    const server = createServer(clock, BASE)
    const alex = openSession(server, clock, 'alex', 'Alex')
    await wait(clock, 1000)

    alex.cutOff()
    alex.type('# Runbook\n\nMove traffic east, then west.\n\nPage the on-call.\n')
    await wait(clock, 70_000)

    // Sam opens the document once the lock lapses, edits another block, leaves.
    const sam = openSession(server, clock, 'sam', 'Sam')
    await wait(clock, 1000)
    expect(sam.current.lock.status).toBe('held')
    sam.type('# Runbook\n\nMove traffic east.\n\nPage the on-call, then the lead.\n')
    await wait(clock, 3000)
    sam.view.unmount()
    await wait(clock, 1000)

    alex.reconnect()
    await wait(clock, 40_000)

    const merged =
      '# Runbook\n\nMove traffic east, then west.\n\nPage the on-call, then the lead.\n'
    expect(text(server.draft.ast)).toBe(merged)
    expect(text(alex.current.content)).toBe(merged)
    expect(alex.merged).toEqual(['Sam'])
    expect(alex.current.reconcile.phase.status).toBe('idle')
    // The base is the merge, agreed with the server.
    expect(contentKey(alex.store.readBase()?.ast ?? {})).toBe(contentKey(md(merged)))
  })

  it('offers both versions of a block both people changed, and saves the resolution', async () => {
    const clock = createFakeClock(0)
    const server = createServer(clock, BASE)
    const alex = openSession(server, clock, 'alex', 'Alex')
    await wait(clock, 1000)

    alex.cutOff()
    alex.type('# Runbook\n\nMove traffic west.\n\nPage the on-call.\n')
    await wait(clock, 70_000)
    const sam = openSession(server, clock, 'sam', 'Sam')
    await wait(clock, 1000)
    sam.type('# Runbook\n\nMove traffic north.\n\nPage the on-call.\n')
    await wait(clock, 3000)
    sam.view.unmount()

    alex.reconnect()
    await wait(clock, 40_000)

    const { phase } = alex.current.reconcile
    expect(phase.status).toBe('conflicted')
    // Nothing is sent while the conflict is open, and the edit and its base stay kept.
    expect(text(server.draft.ast)).toContain('north')
    expect(text(alex.store.read()?.ast)).toContain('west')
    expect(text(alex.store.readBase()?.ast)).toBe(BASE)

    act(() => {
      alex.current.reconcile.resolve([{ kind: 'both' }])
    })
    await wait(clock, 3000)
    expect(text(server.draft.ast)).toBe(
      '# Runbook\n\nMove traffic north.\n\nMove traffic west.\n\nPage the on-call.\n',
    )
    expect(alex.merged).toEqual(['Sam'])
  })

  it('keeps everything while somebody else holds the lock, and merges when they finish', async () => {
    const clock = createFakeClock(0)
    const server = createServer(clock, BASE)
    const alex = openSession(server, clock, 'alex', 'Alex')
    await wait(clock, 1000)

    alex.cutOff()
    alex.type('# Runbook\n\nMove traffic east, then west.\n\nPage the on-call.\n')
    await wait(clock, 70_000)
    const sam = openSession(server, clock, 'sam', 'Sam')
    await wait(clock, 1000)
    sam.type('# Runbook\n\nMove traffic east.\n\nPage the on-call, then the lead.\n')
    await wait(clock, 3000)

    alex.reconnect()
    await wait(clock, 30_000)
    expect(alex.current.lock.status).toBe('held_by_other')
    expect(alex.current.lock.holder?.displayName).toBe('Sam')
    expect(alex.current.reconcile.phase).toMatchObject({ status: 'waiting' })
    expect(text(alex.store.read()?.ast)).toContain('then west')
    expect(text(server.draft.ast)).not.toContain('then west')

    sam.view.unmount()
    await wait(clock, 40_000)
    expect(text(server.draft.ast)).toBe(
      '# Runbook\n\nMove traffic east, then west.\n\nPage the on-call, then the lead.\n',
    )
    expect(alex.merged).toEqual(['Sam'])
  })

  it('lets the author keep theirs over the other draft, as an explicit choice', async () => {
    const clock = createFakeClock(0)
    const server = createServer(clock, BASE)
    const alex = openSession(server, clock, 'alex', 'Alex')
    await wait(clock, 1000)
    alex.cutOff()
    alex.type('# Runbook\n\nMove traffic west.\n\nPage the on-call.\n')
    await wait(clock, 70_000)
    const sam = openSession(server, clock, 'sam', 'Sam')
    await wait(clock, 1000)
    sam.type('# Runbook\n\nMove traffic north.\n\nPage the on-call.\n')
    await wait(clock, 3000)
    sam.view.unmount()
    alex.reconnect()
    await wait(clock, 40_000)

    act(() => {
      alex.current.reconcile.keepMine()
    })
    await wait(clock, 3000)
    expect(text(server.draft.ast)).toBe('# Runbook\n\nMove traffic west.\n\nPage the on-call.\n')
    expect(alex.merged).toEqual([])
  })
})
