import { describe, expect, it, vi } from 'vitest'

import type { ChunkResponse } from './paste-chunk.ts'

/**
 * A worker whose pipeline cannot load — a chunk the network lost — still
 * answers every piece, with why it cannot, so the page parses them itself
 * (`markdown-parser.ts`) rather than waiting for ever.
 */

vi.mock('./paste-chunk.ts', () => {
  throw new Error('The chunk did not load.')
})

describe('a parse worker that cannot load its pipeline', () => {
  it('answers each piece with the failure, by its id', async () => {
    const answers: ChunkResponse[] = []
    const post = vi.spyOn(globalThis, 'postMessage').mockImplementation((message: unknown) => {
      answers.push(message as ChunkResponse)
    })
    await import('./markdown-parse.worker.ts')
    const job = {
      id: 7,
      text: '# Title\n',
      line: 0,
      offset: 0,
      borrowed: undefined,
      blankLinesBefore: undefined,
    }
    dispatchEvent(new MessageEvent('message', { data: job }))
    await vi.waitFor(
      () => {
        expect(answers).toHaveLength(1)
      },
      { timeout: 10_000 },
    )
    expect(answers).toEqual([{ id: 7, error: expect.any(String) }])
    post.mockRestore()
  })
})
