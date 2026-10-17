import { describe, expect, it, vi } from 'vitest'

import {
  createRevertChannel,
  memoryRevertTransports,
  revertChannelName,
  type RevertOutcome,
} from './revert-channel.ts'

const REQUEST = { from: 'b'.repeat(40), draftVersion: 3, changes: ['c1', 'c2'] }

function twoTabs(timing: { claimMs?: number; doneMs?: number } = {}) {
  const transports = memoryRevertTransports()
  return {
    comparison: createRevertChannel(transports.transport(), timing),
    editor: createRevertChannel(transports.transport(), timing),
  }
}

describe('asking an open editor to put changes back', () => {
  it('hands the request to the editor and answers with how it went', async () => {
    const { comparison, editor } = twoTabs()
    const handler = vi.fn<() => Promise<RevertOutcome>>(() => Promise.resolve({ ok: true }))
    editor.serve(handler)

    await expect(comparison.ask(REQUEST)).resolves.toEqual({ ok: true })
    expect(handler).toHaveBeenCalledWith(REQUEST)
  })

  it('carries the editor’s refusal, in its words', async () => {
    const { comparison, editor } = twoTabs()
    editor.serve(() => Promise.resolve({ ok: false, message: 'Your draft changed.' }))

    await expect(comparison.ask(REQUEST)).resolves.toEqual({
      ok: false,
      message: 'Your draft changed.',
    })
  })

  it('says a failing editor failed, rather than waiting for ever', async () => {
    const { comparison, editor } = twoTabs()
    editor.serve(() => Promise.reject(new Error('boom')))

    const answer = await comparison.ask(REQUEST)

    expect(answer.ok).toBe(false)
  })

  it('says nobody answered when no editor is open', async () => {
    const { comparison } = twoTabs({ claimMs: 10 })

    await expect(comparison.ask(REQUEST)).resolves.toEqual({ ok: 'no-editor' })
  })

  it('stops waiting on an editor that claimed a request and never finished it', async () => {
    const { comparison, editor } = twoTabs({ doneMs: 10 })
    editor.serve(() => new Promise(() => {}))

    const answer = await comparison.ask(REQUEST)

    expect(answer).toMatchObject({ ok: false, message: expect.stringMatching(/did not answer/u) })
  })

  it('is not served once the editor has gone', async () => {
    const { comparison, editor } = twoTabs({ claimMs: 10 })
    const stop = editor.serve(() => Promise.resolve({ ok: true as const }))
    stop()

    await expect(comparison.ask(REQUEST)).resolves.toEqual({ ok: 'no-editor' })
  })

  it('ignores what is not one of its messages', async () => {
    const transports = memoryRevertTransports()
    const stranger = transports.transport()
    const editor = createRevertChannel(transports.transport())
    const handler = vi.fn<() => Promise<RevertOutcome>>(() => Promise.resolve({ ok: true }))
    editor.serve(handler)

    stranger.post({ kind: 'revert', requestId: 'x', request: { changes: 'all' } })
    stranger.post('hello')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(handler).not.toHaveBeenCalled()
  })

  it('meets on a name of the document’s own', () => {
    expect(revertChannelName('doc-1')).toMatch(/-revert:doc-1$/u)
  })
})
