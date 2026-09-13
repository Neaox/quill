import { documentId, workspaceId } from '@quill/domain'
import type { WorkspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { groupByWorkspaceAffinity } from './group-by-workspace-affinity.ts'
import type { SearchServiceHit } from './search-result.ts'

const WORKSPACE_A = workspaceId('11111111-1111-4111-8111-111111111111')
const WORKSPACE_B = workspaceId('22222222-2222-4222-8222-222222222222')
const WORKSPACE_C = workspaceId('33333333-3333-4333-8333-333333333333')

let counter = 0
function hit(workspace: WorkspaceId, score: number): SearchServiceHit {
  counter += 1
  const id = counter.toString(16).padStart(12, '0')
  return {
    documentId: documentId(`44444444-4444-4444-8444-${id}`),
    workspaceId: workspace,
    title: `Document ${counter}`,
    snippet: { text: '', ranges: [] },
    score,
  }
}

describe('groupByWorkspaceAffinity', () => {
  it('puts everything in elsewhere, grouped by workspace, when there is no current workspace', () => {
    const hits = [hit(WORKSPACE_A, 3), hit(WORKSPACE_B, 2)]
    const result = groupByWorkspaceAffinity(hits, undefined)
    expect(result.current).toEqual([])
    expect(result.elsewhere).toEqual([
      { workspaceId: WORKSPACE_A, hits: [hits[0]] },
      { workspaceId: WORKSPACE_B, hits: [hits[1]] },
    ])
  })

  it('separates the current workspace’s hits from every other workspace', () => {
    const currentHit = hit(WORKSPACE_A, 5)
    const otherHit = hit(WORKSPACE_B, 4)
    const result = groupByWorkspaceAffinity([currentHit, otherHit], WORKSPACE_A)
    expect(result.current).toEqual([currentHit])
    expect(result.elsewhere).toEqual([{ workspaceId: WORKSPACE_B, hits: [otherHit] }])
  })

  it('preserves relevance order within each group', () => {
    const first = hit(WORKSPACE_B, 9)
    const second = hit(WORKSPACE_B, 1)
    const result = groupByWorkspaceAffinity([first, second], WORKSPACE_A)
    expect(result.elsewhere).toEqual([{ workspaceId: WORKSPACE_B, hits: [first, second] }])
  })

  it('orders elsewhere groups by their best hit’s score, highest first', () => {
    const weakGroup = hit(WORKSPACE_B, 1)
    const strongGroup = hit(WORKSPACE_C, 8)
    const result = groupByWorkspaceAffinity([weakGroup, strongGroup], WORKSPACE_A)
    expect(result.elsewhere.map((group) => group.workspaceId)).toEqual([WORKSPACE_C, WORKSPACE_B])
  })

  it('returns empty groups for no hits', () => {
    expect(groupByWorkspaceAffinity([], WORKSPACE_A)).toEqual({ current: [], elsewhere: [] })
  })
})
