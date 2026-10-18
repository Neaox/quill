import { afterEach, describe, expect, it, vi } from 'vitest'

import { editorLinkAddress, openEditorLink, sectionAddress } from './editor-links.ts'

describe('the editor’s links', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens a link to another document at its reading page, fragment and all', () => {
    expect(editorLinkAddress('/d/abc', 'eng', 'https://q.test')).toBe('https://q.test/w/eng/d/abc')
    expect(editorLinkAddress('/d/abc#user-content-set-up', 'eng', 'https://q.test')).toBe(
      'https://q.test/w/eng/d/abc#user-content-set-up',
    )
  })

  it('opens any other address as it is', () => {
    expect(editorLinkAddress('https://example.com', 'eng', 'https://q.test')).toBe(
      'https://example.com',
    )
  })

  it('links to a section of this document', () => {
    expect(sectionAddress('eng', 'abc', 'user-content-b', 'https://q.test')).toBe(
      'https://q.test/w/eng/d/abc#user-content-b',
    )
  })

  it('opens in a new tab with no way back to this one', () => {
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null)
    openEditorLink('https://example.com', 'eng')
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })
})
