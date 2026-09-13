import { describe, expect, it } from 'vitest'

import {
  collectionId,
  documentId,
  groupId,
  instanceId,
  isShortId,
  isUuid,
  revisionId,
  shareLinkId,
  shortId,
  unitId,
  userId,
  workspaceId,
} from './ids.ts'

const VALID = '018f4c1e-7c3a-7c1d-9b2e-1f2a3b4c5d6e'

const CONSTRUCTORS = [
  ['InstanceId', instanceId],
  ['UnitId', unitId],
  ['WorkspaceId', workspaceId],
  ['CollectionId', collectionId],
  ['DocumentId', documentId],
  ['GroupId', groupId],
  ['UserId', userId],
  ['ShareLinkId', shareLinkId],
] as const

describe('isUuid', () => {
  it('accepts RFC 9562 UUIDs of versions 1 to 8', () => {
    expect(isUuid(VALID)).toBe(true)
    expect(isUuid('123e4567-e89b-42d3-a456-426614174000')).toBe(true)
  })

  it('rejects malformed values', () => {
    expect(isUuid('')).toBe(false)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('018f4c1e-7c3a-0c1d-9b2e-1f2a3b4c5d6e')).toBe(false)
  })
})

describe('branded id constructors', () => {
  it.each(CONSTRUCTORS)('%s normalises valid UUIDs to lower case', (_kind, construct) => {
    expect(construct(VALID.toUpperCase())).toBe(VALID)
  })

  it.each(CONSTRUCTORS)('%s throws a TypeError naming the kind', (kind, construct) => {
    expect(() => construct('nope')).toThrow(new RegExp(`Invalid ${kind}`))
  })
})

describe('revisionId', () => {
  it('accepts a 40-character lower-case hex string', () => {
    const sha = 'a'.repeat(40)
    expect(revisionId(sha)).toBe(sha)
  })

  it('rejects anything else', () => {
    expect(() => revisionId('abc')).toThrow(/Invalid RevisionId/)
    expect(() => revisionId('A'.repeat(40))).toThrow(/Invalid RevisionId/)
  })
})

describe('isShortId', () => {
  it('accepts a ten-character Crockford key, however it was typed', () => {
    expect(isShortId('k7m3q9v2xd')).toBe(true)
    expect(isShortId('K7M3Q9V2XD')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isShortId('k7m3q9v2x')).toBe(false)
    expect(isShortId(VALID)).toBe(false)
  })
})

describe('shortId', () => {
  it('normalises the confusable forms to the canonical key', () => {
    expect(shortId('K7M3Q9V2XI')).toBe('k7m3q9v2x1')
  })

  it('throws a TypeError naming the kind', () => {
    expect(() => shortId('nope')).toThrow(/Invalid ShortId/)
  })
})
