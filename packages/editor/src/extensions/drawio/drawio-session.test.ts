import { describe, expect, it } from 'vitest'

import type { DrawioSessionEvent, DrawioSessionState } from './drawio-session.ts'
import {
  drawioSessionReducer,
  hasUnsavedChanges,
  initialDrawioSessionState,
} from './drawio-session.ts'

const run = (...events: DrawioSessionEvent[]): DrawioSessionState =>
  events.reduce(drawioSessionReducer, initialDrawioSessionState)

const ready = (dirty = false): DrawioSessionState => ({ status: 'ready', dirty })

describe('drawioSessionReducer', () => {
  it('loads, then tracks whether there are unsaved changes', () => {
    expect(run()).toEqual({ status: 'loading' })
    expect(run({ type: 'loaded' })).toEqual(ready())
    expect(run({ type: 'loaded' }, { type: 'changed' })).toEqual(ready(true))
    expect(run({ type: 'changed' })).toEqual({ status: 'loading' })
  })

  it('saves, and is clean until the next change', () => {
    const saving = run(
      { type: 'loaded' },
      { type: 'changed' },
      { type: 'save-requested', exit: false },
    )
    expect(saving).toEqual({ status: 'saving', exit: false, copy: false })
    expect(drawioSessionReducer(saving, { type: 'save-requested', exit: true })).toBe(saving)

    const saved = drawioSessionReducer(saving, { type: 'saved', version: 3 })
    expect(saved).toEqual({ status: 'saved', version: 3 })
    expect(drawioSessionReducer(saved, { type: 'changed' })).toEqual(ready(true))
  })

  it('closes once a "Save & Exit" has been written', () => {
    expect(
      run(
        { type: 'loaded' },
        { type: 'save-requested', exit: true },
        { type: 'saved', version: 2 },
      ),
    ).toEqual({ status: 'closed' })
  })

  it('stops at a conflict, then saves a copy or reloads', () => {
    const conflict = run(
      { type: 'loaded' },
      { type: 'save-requested', exit: true },
      { type: 'conflicted', currentVersion: 4 },
    )
    expect(conflict).toEqual({ status: 'conflict', exit: true, currentVersion: 4 })
    expect(hasUnsavedChanges(conflict)).toBe(true)

    expect(drawioSessionReducer(conflict, { type: 'copy-requested' })).toEqual({
      status: 'saving',
      exit: true,
      copy: true,
    })
    expect(drawioSessionReducer(conflict, { type: 'reload-requested' })).toEqual({
      status: 'loading',
    })
  })

  it('reports a failure, remembering whether work is unsaved', () => {
    const failedSave = run(
      { type: 'loaded' },
      { type: 'save-requested', exit: false },
      { type: 'failed', message: 'Offline', retry: 'save' },
    )
    expect(failedSave).toEqual({ status: 'error', message: 'Offline', dirty: true, retry: 'save' })
    expect(run({ type: 'failed', message: 'The editor did not load', retry: 'none' })).toEqual({
      status: 'error',
      message: 'The editor did not load',
      dirty: false,
      retry: 'none',
    })
  })

  it('tries again as the failure says: the save, the opening, or not at all', () => {
    const failed = (retry: 'open' | 'save' | 'none'): DrawioSessionState =>
      run({ type: 'failed', message: 'x', retry })
    expect(drawioSessionReducer(failed('save'), { type: 'retried' })).toEqual({
      status: 'saving',
      exit: false,
      copy: false,
    })
    expect(drawioSessionReducer(failed('open'), { type: 'retried' })).toEqual({ status: 'loading' })
    expect(drawioSessionReducer(failed('none'), { type: 'retried' })).toEqual(failed('none'))
    expect(drawioSessionReducer(ready(), { type: 'retried' })).toEqual(ready())
  })

  it('asks before closing with unsaved changes, and goes back on "Keep editing"', () => {
    const dirty = run({ type: 'loaded' }, { type: 'changed' })
    const asking = drawioSessionReducer(dirty, { type: 'close-requested' })
    expect(asking).toEqual({ status: 'confirming-close', back: dirty })
    expect(hasUnsavedChanges(asking)).toBe(true)
    expect(drawioSessionReducer(asking, { type: 'close-requested' })).toBe(asking)
    expect(drawioSessionReducer(asking, { type: 'close-cancelled' })).toBe(dirty)
    expect(drawioSessionReducer(asking, { type: 'close-confirmed' })).toEqual({ status: 'closed' })
  })

  it('closes at once when nothing would be lost', () => {
    expect(run({ type: 'loaded' }, { type: 'close-requested' })).toEqual({ status: 'closed' })
    expect(run({ type: 'close-requested' })).toEqual({ status: 'closed' })
    expect(
      run(
        { type: 'loaded' },
        { type: 'save-requested', exit: false },
        { type: 'saved', version: 2 },
        { type: 'close-requested' },
      ),
    ).toEqual({ status: 'closed' })
  })

  it('closes on draw.io’s own Exit, which has already asked', () => {
    expect(run({ type: 'loaded' }, { type: 'changed' }, { type: 'exited' })).toEqual({
      status: 'closed',
    })
  })

  it('ignores what does not apply to the state it is in, and everything once closed', () => {
    expect(drawioSessionReducer(ready(), { type: 'saved', version: 1 })).toEqual(ready())
    expect(drawioSessionReducer(ready(), { type: 'conflicted', currentVersion: 1 })).toEqual(
      ready(),
    )
    expect(drawioSessionReducer(ready(), { type: 'copy-requested' })).toEqual(ready())
    expect(drawioSessionReducer(ready(), { type: 'close-cancelled' })).toEqual(ready())
    const closed: DrawioSessionState = { status: 'closed' }
    expect(drawioSessionReducer(closed, { type: 'loaded' })).toBe(closed)
    expect(hasUnsavedChanges(closed)).toBe(false)
    expect(hasUnsavedChanges({ status: 'saving', exit: false, copy: false })).toBe(true)
  })
})
