import { describe, expect, it } from 'vitest'

import { parseMarkdown } from '../pipeline/processor.ts'
import { mergeDocuments } from './merge-documents.ts'
import type { MergeResponse, MergeWorkerScope } from './merge-worker.ts'
import { answerMergeRequest, isMergeRequest, serveMerges } from './merge-worker.ts'

const request = {
  id: 7,
  base: parseMarkdown('One.\n\nTwo.\n'),
  mine: parseMarkdown('One, mine.\n\nTwo.\n'),
  theirs: parseMarkdown('One.\n\nTwo, theirs.\n'),
}

function fakeScope() {
  let listener: ((event: { readonly data: unknown }) => void) | undefined
  const posted: MergeResponse[] = []
  const scope: MergeWorkerScope = {
    addEventListener: (_type, next) => {
      listener = next
    },
    postMessage: (message) => {
      posted.push(message)
    },
  }
  return { scope, posted, send: (data: unknown) => listener?.({ data }) }
}

describe('the merge worker', () => {
  it('answers a request with the same merge the main thread would make', () => {
    expect(answerMergeRequest(request)).toEqual({
      id: 7,
      merge: mergeDocuments(request.base, request.mine, request.theirs),
    })
  })

  it('recognises only well-formed requests', () => {
    expect(isMergeRequest(request)).toBe(true)
    expect(isMergeRequest(null)).toBe(false)
    expect(isMergeRequest('merge')).toBe(false)
    expect(isMergeRequest({ ...request, id: '7' })).toBe(false)
    expect(isMergeRequest({ ...request, base: { type: 'paragraph' } })).toBe(false)
    expect(isMergeRequest({ ...request, mine: { type: 'root' } })).toBe(false)
    expect(isMergeRequest({ ...request, theirs: null })).toBe(false)
    expect(isMergeRequest({ id: 1 })).toBe(false)
  })

  it('posts an answer to each request and ignores anything else', () => {
    const { scope, posted, send } = fakeScope()
    serveMerges(scope)
    send({ hello: 'world' })
    send(request)
    expect(posted).toEqual([answerMergeRequest(request)])
  })
})
