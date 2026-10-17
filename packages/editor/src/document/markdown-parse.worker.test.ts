import { describe, expect, it, vi } from 'vitest'

import type { ChunkResponse } from './paste-chunk.ts'
import { answerChunk } from './paste-chunk.ts'

/** The worker's whole job, run in the page's global scope as the worker's would be. */
describe('the parse worker', () => {
  it('answers each piece with its editor blocks, entities decoded', async () => {
    const answers: ChunkResponse[] = []
    const post = vi.spyOn(globalThis, 'postMessage').mockImplementation((message: unknown) => {
      answers.push(message as ChunkResponse)
    })
    await import('./markdown-parse.worker.ts')
    const job = {
      id: 1,
      text: '# Title &copy;\n',
      line: 0,
      offset: 0,
      borrowed: undefined,
      blankLinesBefore: undefined,
    }
    dispatchEvent(new MessageEvent('message', { data: job }))
    await vi.waitFor(() => {
      expect(answers).toHaveLength(1)
    })
    expect(answers).toEqual([answerChunk(job)])
    expect(JSON.stringify(answers)).toContain('Title ©')
    post.mockRestore()
  })
})
