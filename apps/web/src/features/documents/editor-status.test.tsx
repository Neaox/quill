import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { describeEditorStatus, EditorStatus, OFFLINE_LABEL } from './editor-status.tsx'

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
    ['a stale draft', { autosave: 'conflict', lock: 'held' }, 'draft changed elsewhere'],
    ['a refused save', { autosave: 'failed', lock: 'held' }, 'couldn’t save'],
    ['a browser gone offline', { autosave: 'offline', lock: 'reconnecting' }, OFFLINE_LABEL],
    ['a save that could not be delivered', { autosave: 'retrying', lock: 'held' }, OFFLINE_LABEL],
    ['two missed heartbeats', { autosave: 'saved', lock: 'at_risk' }, OFFLINE_LABEL],
    ['one missed heartbeat', { autosave: 'saved', lock: 'reconnecting' }, OFFLINE_LABEL],
    ['a lock still being taken', { autosave: 'idle', lock: 'acquiring' }, 'opening'],
  ] as const)('outranks a good autosave with %s', (_name, input, label) => {
    const status = describeEditorStatus({ ...input, holderName: undefined })

    expect(status.label).toBe(label)
    expect(status.atRisk).toBe(true)
  })

  it.each([
    ['conflicted', 'changes to resolve'],
    ['merging', 'merging your changes…'],
    ['relocking', 'reconnecting…'],
  ] as const)('says when a reconnect is %s', (reconcile, label) => {
    expect(
      describeEditorStatus({ autosave: 'dirty', lock: 'held', holderName: undefined, reconcile })
        .label,
    ).toBe(label)
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
    ['saving', 'saving…'],
    ['dirty', 'unsaved changes'],
    ['idle', 'editing'],
  ] as const)('reports %s while the lock is held', (autosave, label) => {
    expect(describeEditorStatus({ autosave, lock: 'held', holderName: undefined }).label).toBe(
      label,
    )
  })
})

describe('EditorStatus', () => {
  it('offers Retry beside a save that could not be made, and nowhere else', async () => {
    let retried = 0
    const { rerender } = render(
      <EditorStatus
        autosave="failed"
        lock="held"
        holderName={undefined}
        onRetry={() => {
          retried += 1
        }}
      />,
    )

    screen.getByRole('button', { name: 'Retry' }).click()
    expect(retried).toBe(1)

    rerender(
      <EditorStatus autosave="saved" lock="held" holderName={undefined} onRetry={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('announces itself politely, because it changes without anyone looking', () => {
    render(<EditorStatus autosave="saved" lock="held" holderName={undefined} />)

    const status = screen.getByText('draft saved')
    expect(status.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
  })
})
