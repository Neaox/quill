import { describe, expect, it } from 'vitest'

import type { AutosaveEvent, AutosavePhase, AutosaveState } from './autosave-machine.ts'
import { autosaveReducer, failuresSoFar, initialAutosaveState } from './autosave-machine.ts'

const at = (phase: AutosavePhase, draftVersion = 3): AutosaveState => ({
  phase,
  draftVersion,
  lastSavedAt: null,
})

const run = (state: AutosaveState, ...events: AutosaveEvent[]) =>
  events.reduce(autosaveReducer, state)

describe('autosaveReducer', () => {
  it('starts idle, or dirty when a previous session left an edit behind', () => {
    expect(initialAutosaveState(3, false).phase).toEqual({ status: 'idle' })
    expect(initialAutosaveState(3, true).phase).toEqual({ status: 'dirty' })
  })

  it('goes dirty, saving, saved', () => {
    const state = run(
      initialAutosaveState(3, false),
      { type: 'edited' },
      { type: 'save-started' },
      { type: 'saved', draftVersion: 4, savedAt: 10, more: false },
    )
    expect(state).toEqual({ phase: { status: 'saved' }, draftVersion: 4, lastSavedAt: 10 })
  })

  it('coalesces an edit made in flight into the next save rather than dropping it', () => {
    const state = run(at({ status: 'saving', attempt: 0 }), { type: 'edited' })
    expect(state.phase).toEqual({ status: 'saving', attempt: 0 })
    expect(
      autosaveReducer(state, { type: 'saved', draftVersion: 4, savedAt: 1, more: true }).phase,
    ).toEqual({ status: 'dirty' })
  })

  it('counts consecutive transient failures, and forgets them on success', () => {
    let state = run(at({ status: 'dirty' }), { type: 'save-started' })
    state = autosaveReducer(state, { type: 'unavailable', attempt: 1, nextAt: 1000, online: true })
    expect(state.phase).toEqual({ status: 'retrying', attempt: 1, nextAt: 1000 })
    expect(failuresSoFar(state)).toBe(1)

    state = run(state, { type: 'save-started' })
    expect(state.phase).toEqual({ status: 'saving', attempt: 1 })
    state = autosaveReducer(state, { type: 'unavailable', attempt: 2, nextAt: 3000, online: false })
    expect(state.phase).toEqual({ status: 'offline', attempt: 2 })

    state = run(
      state,
      { type: 'connectivity-back', now: 5000 },
      { type: 'save-started' },
      { type: 'saved', draftVersion: 4, savedAt: 1, more: false },
    )
    expect(failuresSoFar(state)).toBe(0)
  })

  it('goes offline from dirty or retrying, and comes back to an immediate retry', () => {
    expect(run(at({ status: 'dirty' }), { type: 'went-offline' }).phase).toEqual({
      status: 'offline',
      attempt: 0,
    })
    expect(
      run(at({ status: 'offline', attempt: 2 }), { type: 'connectivity-back', now: 50 }).phase,
    ).toEqual({ status: 'retrying', attempt: 2, nextAt: 50 })
    // Coming back online never unblocks a lost lock or a refusal by itself.
    const blocked = at({ status: 'blocked', holder: null })
    expect(run(blocked, { type: 'connectivity-back', now: 50 })).toBe(blocked)
    expect(run(at({ status: 'saved' }), { type: 'went-offline' }).phase).toEqual({
      status: 'saved',
    })
  })

  it('learns from another tab that its base version is stale', () => {
    expect(run(at({ status: 'saved' }), { type: 'remote-saved', draftVersion: 4 }).phase).toEqual({
      status: 'conflict',
      currentVersion: 4,
    })
    // Its own version, or an older one, is no news.
    expect(run(at({ status: 'saved' }), { type: 'remote-saved', draftVersion: 3 }).phase).toEqual({
      status: 'saved',
    })
    // A save in flight will hear the same thing from the server, with the version.
    expect(
      run(at({ status: 'saving', attempt: 0 }), { type: 'remote-saved', draftVersion: 9 }).phase,
    ).toEqual({ status: 'saving', attempt: 0 })
  })

  it('stays stopped on a conflict until the author chooses, then saves on the new base', () => {
    const conflict = at({ status: 'conflict', currentVersion: 7 })
    expect(run(conflict, { type: 'edited' }).phase).toEqual(conflict.phase)
    expect(run(conflict, { type: 'retry-now', now: 0, pending: true }).phase).toEqual(
      conflict.phase,
    )
    expect(run(conflict, { type: 'rebased', draftVersion: 7, pending: true })).toEqual(
      at({ status: 'dirty' }, 7),
    )
    expect(run(conflict, { type: 'rebased', draftVersion: 7, pending: false })).toEqual(
      at({ status: 'idle' }, 7),
    )
  })

  it('rebases only out of a conflict', () => {
    const saved = at({ status: 'saved' })
    expect(run(saved, { type: 'rebased', draftVersion: 9, pending: true })).toBe(saved)
  })

  it('resumes a blocked or failed save when asked', () => {
    const blocked = at({ status: 'blocked', holder: null })
    expect(run(blocked, { type: 'edited' }).phase).toEqual(blocked.phase)
    expect(run(blocked, { type: 'retry-now', now: 0, pending: true }).phase).toEqual({
      status: 'dirty',
    })
    expect(run(blocked, { type: 'retry-now', now: 0, pending: false }).phase).toEqual({
      status: 'idle',
    })

    // Pressed while waiting to retry, or offline, it goes now.
    const waiting = at({ status: 'retrying', attempt: 3, nextAt: 9000 })
    expect(run(waiting, { type: 'retry-now', now: 1, pending: true }).phase).toEqual({
      status: 'retrying',
      attempt: 3,
      nextAt: 1,
    })
    const offline = at({ status: 'offline', attempt: 1 })
    expect(run(offline, { type: 'retry-now', now: 2, pending: true }).phase).toEqual({
      status: 'retrying',
      attempt: 1,
      nextAt: 2,
    })

    const failed = at({ status: 'failed', reason: 'Too large' })
    expect(run(failed, { type: 'retry-now', now: 9, pending: true }).phase).toEqual({
      status: 'retrying',
      attempt: 0,
      nextAt: 9,
    })
    // A later edit tries again by itself: one refusal never stops autosave for good.
    expect(run(failed, { type: 'edited' }).phase).toEqual({ status: 'dirty' })
  })
})

describe('autosaveReducer: a merge settles whatever stopped autosave', () => {
  it.each([
    ['conflict', { status: 'conflict', currentVersion: 6 }],
    ['blocked', { status: 'blocked', holder: null }],
    ['offline', { status: 'offline', attempt: 2 }],
  ] as const)('from %s, onto the merged version', (_name, phase) => {
    expect(run(at(phase), { type: 'merged', draftVersion: 6, pending: true })).toEqual({
      phase: { status: 'dirty' },
      draftVersion: 6,
      lastSavedAt: null,
    })
  })

  it('goes idle when the server’s draft was adopted with nothing of ours to send', () => {
    expect(
      run(at({ status: 'conflict', currentVersion: 6 }), {
        type: 'merged',
        draftVersion: 6,
        pending: false,
      }).phase,
    ).toEqual({ status: 'idle' })
  })
})
