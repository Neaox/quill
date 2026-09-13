import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { queryKeys, type DraftDto } from '../../../lib/api/index.ts'
import { DRAFT_CONTENT_VERSION } from '../../../lib/documents/draft-content.ts'
import { useWriteDraftFrontMatter } from './draft-front-matter.ts'

const DRAFT: DraftDto = {
  documentId: 'doc-1',
  draftVersion: 3,
  baseRevision: null,
  ast: {
    version: DRAFT_CONTENT_VERSION,
    frontMatter: { id: 'doc-1', type: 'runbook' },
    ast: { type: 'root', children: [] },
  },
  updatedAt: '2026-02-03T00:00:00.000Z',
}

function mount(seed?: DraftDto) {
  const queryClient = new QueryClient()
  if (seed !== undefined) queryClient.setQueryData(queryKeys.draft('doc-1'), seed)
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useWriteDraftFrontMatter('doc-1'), { wrapper })
  return {
    write: result.current,
    read: () => queryClient.getQueryData<DraftDto>(queryKeys.draft('doc-1')),
  }
}

describe("writing the draft's front matter", () => {
  it('replaces the record in the envelope and leaves the tree alone', () => {
    const { write, read } = mount(DRAFT)
    write({ id: 'doc-1', type: 'design', status: 'draft' })
    expect(read()?.ast).toEqual({
      version: DRAFT_CONTENT_VERSION,
      frontMatter: { id: 'doc-1', type: 'design', status: 'draft' },
      ast: { type: 'root', children: [] },
    })
    expect(read()?.draftVersion).toBe(3)
  })

  it('writes nothing when there is no draft to write onto', () => {
    const { write, read } = mount()
    write({ type: 'design' })
    expect(read()).toBeUndefined()
  })

  it('leaves a draft this release cannot read exactly as it found it (ADR-033)', () => {
    const unreadable = { ...DRAFT, ast: { version: 99, frontMatter: {}, ast: null } } as DraftDto
    const { write, read } = mount(unreadable)
    write({ type: 'design' })
    expect(read()).toBe(unreadable)
  })
})
