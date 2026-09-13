import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { describeEditorStatus, EditorStatus } from './editor-status.tsx'

describe('describeEditorStatus', () => {
  it('reports a saved draft once the lock is held and the save came back', () => {
    expect(
      describeEditorStatus({ autosave: 'saved', lock: 'held', holderName: undefined }),
    ).toEqual({ tone: 'success', label: 'draft saved', atRisk: false })
  })

  // Everything that means "your next keystroke may not be saved" outranks
  // everything that means "it was" (ADR-021: uncertain is not fine).
  it.each([
    ['a signed-out session', { autosave: 'signed_out', lock: 'held' }, 'signed out'],
    ['a lost lock', { autosave: 'saved', lock: 'lost' }, 'lock lost'],
    ['a blocked autosave', { autosave: 'blocked', lock: 'held' }, 'lock lost'],
    ['a stale draft', { autosave: 'stale', lock: 'held' }, 'draft changed elsewhere'],
    ['two missed heartbeats', { autosave: 'saved', lock: 'at_risk' }, 'connection lost'],
    ['one missed heartbeat', { autosave: 'saved', lock: 'reconnecting' }, 'reconnecting'],
    ['a lock still being taken', { autosave: 'idle', lock: 'acquiring' }, 'opening'],
  ] as const)('outranks a good autosave with %s', (_name, input, label) => {
    const status = describeEditorStatus({ ...input, holderName: undefined })

    expect(status.label).toBe(label)
    expect(status.atRisk).toBe(true)
  })

  it('names the person holding the lock when the envelope knows it', () => {
    expect(
      describeEditorStatus({ autosave: 'idle', lock: 'held_by_other', holderName: 'Grace' }).label,
    ).toBe('Grace is editing')
    expect(
      describeEditorStatus({ autosave: 'idle', lock: 'held_by_other', holderName: undefined })
        .label,
    ).toBe('someone else is editing')
  })

  it.each([
    ['saving', 'saving'],
    ['pending', 'unsaved changes'],
    ['idle', 'editing'],
  ] as const)('reports %s while the lock is held', (autosave, label) => {
    expect(describeEditorStatus({ autosave, lock: 'held', holderName: undefined }).label).toBe(
      label,
    )
  })
})

describe('EditorStatus', () => {
  it('announces itself politely, because it changes without anyone looking', () => {
    render(<EditorStatus autosave="saved" lock="held" holderName={undefined} />)

    const status = screen.getByText('draft saved')
    expect(status.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
  })
})
