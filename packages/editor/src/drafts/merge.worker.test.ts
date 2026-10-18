import { describe, expect, it, vi } from 'vitest'

import { mergeDocuments, parseMarkdown } from '@quill/markdown'
import type { MergeResponse } from '@quill/markdown/merge-worker'

/** The worker's whole job, run in the page's global scope as the worker's would be. */
describe('the merge worker', () => {
  it('answers each merge request with the merge', async () => {
    const answers: MergeResponse[] = []
    const post = vi.spyOn(globalThis, 'postMessage').mockImplementation((message: unknown) => {
      answers.push(message as MergeResponse)
    })
    await import('./merge.worker.ts')
    const request = {
      id: 3,
      base: parseMarkdown('A.\n'),
      mine: parseMarkdown('A, mine.\n'),
      theirs: parseMarkdown('A.\n\nB.\n'),
    }
    dispatchEvent(new MessageEvent('message', { data: request }))
    expect(answers).toEqual([
      { id: 3, merge: mergeDocuments(request.base, request.mine, request.theirs) },
    ])
    post.mockRestore()
  })
})
