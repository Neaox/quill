import { describe, expect, it, vi } from 'vitest'

import { createRevertChannel, memoryRevertTransports } from '../../../lib/documents/revert-channel.ts'
import { putBack, RevertRefused, revertRefusal, whyNot } from './revert-changes.tsx'

function tabs() {
  const transports = memoryRevertTransports()
  return {
    comparison: createRevertChannel(transports.transport(), { claimMs: 20 }),
    editor: createRevertChannel(transports.transport(), { claimMs: 20 }),
  }
}

const REQUEST = { from: 'b'.repeat(40), draftVersion: 3, changes: ['c1'] }

describe('where reverted changes go', () => {
  it('goes to the editor this browser has open, which holds the draft, and writes nothing itself', async () => {
    const { comparison, editor } = tabs()
    const served = vi.fn(() => Promise.resolve({ ok: true as const }))
    editor.serve(served)
    const write = vi.fn(() => Promise.resolve({ draftVersion: 4, previous: {} }))

    const result = await putBack({ channel: comparison, ...REQUEST, write })

    expect(result).toEqual({ kind: 'in-editor' })
    expect(served).toHaveBeenCalledWith(REQUEST)
    expect(write).not.toHaveBeenCalled()
  })

  it('writes the draft itself when no editor is open', async () => {
    const { comparison } = tabs()
    const write = vi.fn(() => Promise.resolve({ draftVersion: 4, previous: { version: 1 } }))

    const result = await putBack({ channel: comparison, ...REQUEST, write })

    expect(result).toEqual({ kind: 'written', draftVersion: 4, previous: { version: 1 } })
  })

  it('says what the open editor said when it could not, and does not write behind its back', async () => {
    const { comparison, editor } = tabs()
    editor.serve(() => Promise.resolve({ ok: false, message: 'Your latest edits were still being saved.' }))
    const write = vi.fn(() => Promise.resolve({ draftVersion: 4, previous: {} }))

    const refused = putBack({ channel: comparison, ...REQUEST, write })

    await expect(refused).rejects.toBeInstanceOf(RevertRefused)
    await expect(refused).rejects.toThrow('Your latest edits were still being saved.')
    expect(write).not.toHaveBeenCalled()
  })
})

describe('why a change cannot be reverted', () => {
  const change = (kind: 'moved' | 'changed') => ({
    id: 'c1',
    change: kind,
    block: 'paragraph',
    excerpt: 'x',
    wordsAdded: 0,
    wordsRemoved: 0,
  })

  it('says a move is the same block in another place', () => {
    expect(whyNot(change('moved')).full).toMatch(/only its place differs/u)
  })

  it('says a block the draft writes differently is to be edited in the editor', () => {
    expect(whyNot(change('changed')).full).toMatch(/Edit it in the editor/u)
  })

  it('carries an open editor’s refusal as it was said', () => {
    expect(revertRefusal(new RevertRefused('As said.'))).toBe('As said.')
    expect(revertRefusal(new Error('boom'))).toMatch(/Couldn’t revert/u)
  })
})
