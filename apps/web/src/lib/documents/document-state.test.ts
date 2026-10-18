import { describe, expect, it } from 'vitest'

import { documentState } from './document-state.ts'

describe('documentState', () => {
  it('calls a document that has never been published a draft, whatever its status says', () => {
    // Regression (2026-10-17): the header said "Published" above "Nothing
    // published yet", because the stated status was read on its own.
    expect(documentState({ status: 'published', headRevision: null })).toBe('draft')
  })

  it('takes the stated status once there is a published revision', () => {
    const head = 'a'.repeat(40)
    expect(documentState({ status: 'published', headRevision: head })).toBe('published')
    expect(documentState({ status: 'draft', headRevision: head })).toBe('draft')
    expect(documentState({ status: 'archived', headRevision: head })).toBe('archived')
  })

  it('says a published document has changes when its draft is ahead of what was published', () => {
    const head = 'a'.repeat(40)
    expect(documentState({ status: 'published', headRevision: head }, true)).toBe('changed')
    expect(documentState({ status: 'published', headRevision: head }, false)).toBe('published')
    // Never published: a draft is a draft, not "changes".
    expect(documentState({ status: 'draft', headRevision: null }, true)).toBe('draft')
  })

  it('keeps an archived document archived even if it was never published', () => {
    expect(documentState({ status: 'archived', headRevision: null })).toBe('archived')
  })
})
