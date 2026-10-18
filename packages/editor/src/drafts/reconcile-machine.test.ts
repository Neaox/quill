import { describe, expect, it } from 'vitest'

import { mergeDocuments } from '@quill/markdown'

import type { ReconcilePhase } from './reconcile-machine.ts'
import { IDLE, reconcileNeed, reconcileReducer } from './reconcile-machine.ts'

const tree = { type: 'root' as const, children: [] }
const theirs = { ast: tree, draftVersion: 4, baseRevision: null }

describe('reconcileReducer', () => {
  it('walks relock, wait, merge, conflict, and settles', () => {
    const merge = mergeDocuments(tree, tree, tree)
    const steps: ReconcilePhase[] = []
    let phase: ReconcilePhase = IDLE
    for (const event of [
      { type: 'relock-started' },
      { type: 'waiting', holder: null },
      { type: 'merge-started' },
      { type: 'conflicted', merge, theirs, mine: tree },
      { type: 'failed', reason: 'down' },
      { type: 'settled' },
    ] as const) {
      phase = reconcileReducer(phase, event)
      steps.push(phase)
    }
    expect(steps.map(({ status }) => status)).toEqual([
      'relocking',
      'waiting',
      'merging',
      'conflicted',
      'failed',
      'idle',
    ])
  })

  it('changes nothing for a merge already running, or a settle with nothing to settle', () => {
    const merging = reconcileReducer(IDLE, { type: 'merge-started' })
    expect(reconcileReducer(merging, { type: 'merge-started' })).toBe(merging)
    expect(reconcileReducer(IDLE, { type: 'settled' })).toBe(IDLE)
  })
})

describe('reconcileNeed', () => {
  it.each([
    ['held_by_other', 'dirty', true, 'wait'],
    ['held_by_other', 'idle', false, 'none'],
    ['held', 'conflict', true, 'merge'],
    ['lost', 'dirty', true, 'relock'],
    ['released', 'saved', false, 'relock'],
    ['held', 'blocked', true, 'relock'],
    ['held', 'saved', false, 'none'],
  ] as const)(
    'lock %s with autosave %s (unsaved: %s) needs %s',
    (lock, autosave, unsaved, need) => {
      expect(reconcileNeed(lock, autosave, unsaved)).toBe(need)
    },
  )
})
