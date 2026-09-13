import { documentId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { decodeSearchCursor, encodeSearchCursor } from './cursor.ts'
import type { SearchCursor } from './cursor.ts'

const DOCUMENT = documentId('11111111-1111-4111-8111-111111111111')
const AT = '2026-02-01T00:00:00.000Z'

const MID_BATCH: SearchCursor = {
  from: 0,
  arm: 'all',
  at: AT,
  keyset: { score: 0.75, documentId: DOCUMENT },
}

const NEXT_BATCH: SearchCursor = { from: 5, arm: 'any', at: AT, keyset: null }

describe('a search cursor', () => {
  it('round-trips a page cut part way through a batch of workspaces', () => {
    expect(decodeSearchCursor(encodeSearchCursor(MID_BATCH))).toEqual(MID_BATCH)
  })

  it('round-trips the start of the next batch of workspaces', () => {
    expect(decodeSearchCursor(encodeSearchCursor(NEXT_BATCH))).toEqual(NEXT_BATCH)
  })

  it('is opaque: nothing readable survives to the client', () => {
    expect(encodeSearchCursor(MID_BATCH)).not.toContain(DOCUMENT)
  })

  it.each([
    ['not base64 at all', '!!!!'],
    ['base64 of something that is not JSON', Buffer.from('nonsense').toString('base64url')],
    ['JSON that is not an object', Buffer.from('"a string"').toString('base64url')],
    ['null', Buffer.from('null').toString('base64url')],
    ['no batch', encoded({ a: 'all', t: AT })],
    ['a batch that is not a whole number', encoded({ w: 1.5, a: 'all', t: AT })],
    ['a batch before the beginning', encoded({ w: -1, a: 'all', t: AT })],
    ['an arm this engine does not have', encoded({ w: 0, a: 'fuzzy', t: AT })],
    ['an instant that is not a date', encoded({ w: 0, a: 'all', t: 'yesterday' })],
    ['an instant that is not a string', encoded({ w: 0, a: 'all', t: 7 })],
    ['a score that is not a number', encoded({ w: 0, a: 'all', t: AT, s: 'high', d: DOCUMENT })],
    [
      'a score that is not finite',
      encoded({ w: 0, a: 'all', t: AT, s: Number.POSITIVE_INFINITY, d: DOCUMENT }),
    ],
    ['half a keyset', encoded({ w: 0, a: 'all', t: AT, s: 1 })],
    ['no document', encoded({ w: 0, a: 'all', t: AT, s: 1, d: '' })],
    ['a document that is not a string', encoded({ w: 0, a: 'all', t: AT, s: 1, d: 7 })],
  ])('refuses %s', (_description, value) => {
    expect(decodeSearchCursor(value)).toBeNull()
  })
})

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}
