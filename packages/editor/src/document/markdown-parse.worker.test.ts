import { parseDocument } from '@quill/markdown'
import { describe, expect, it, vi } from 'vitest'

import type { ParseResponse } from './markdown-parser.ts'

/** The worker's whole job, run in the page's global scope as the worker's would be. */
describe('the parse worker', () => {
  it('answers each message with the parsed tree', async () => {
    const answers: ParseResponse[] = []
    const post = vi.spyOn(globalThis, 'postMessage').mockImplementation((message: unknown) => {
      answers.push(message as ParseResponse)
    })
    await import('./markdown-parse.worker.ts')
    dispatchEvent(new MessageEvent('message', { data: { id: 1, markdown: '# Title\n' } }))
    expect(answers).toEqual([{ id: 1, ast: parseDocument('# Title\n').ast }])
    post.mockRestore()
  })
})
