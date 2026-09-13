import { describe, expect, it } from 'vitest'

import { DOCUMENT_STATUSES, isDocumentStatus } from './document-status.ts'

describe('isDocumentStatus', () => {
  it('accepts every declared status', () => {
    for (const status of DOCUMENT_STATUSES) {
      expect(isDocumentStatus(status)).toBe(true)
    }
  })

  it('rejects unknown strings and non-strings', () => {
    expect(isDocumentStatus('in-review')).toBe(false)
    expect(isDocumentStatus(42)).toBe(false)
    expect(isDocumentStatus(null)).toBe(false)
  })
})
