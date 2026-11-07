import { describe, expect, it } from 'vitest'

import {
  AUTHORED_AT_MAX_SKEW_MS,
  checkSourceStamp,
  SOURCE_REVISION_MAX_LENGTH,
} from './content-store.ts'

const NOW = new Date('2026-11-07T12:00:00.000Z')
const COMMIT = 'a'.repeat(40)

describe('checkSourceStamp', () => {
  it('passes a native publish, which carries no stamp', () => {
    expect(checkSourceStamp({}, NOW)).toBeNull()
  })

  it('passes a replayed revision from the past with its source revision', () => {
    const authoredAt = new Date('2019-03-01T08:30:00.000Z')
    expect(checkSourceStamp({ authoredAt, sourceRevision: COMMIT }, NOW)).toBeNull()
  })

  it('allows a source clock a little ahead of ours, and no further', () => {
    const edge = new Date(NOW.getTime() + AUTHORED_AT_MAX_SKEW_MS)
    expect(checkSourceStamp({ authoredAt: edge }, NOW)).toBeNull()
    const beyond = new Date(edge.getTime() + 1)
    expect(checkSourceStamp({ authoredAt: beyond }, NOW)).toBe('authored-at-in-future')
  })

  it('refuses a time that is not a time', () => {
    expect(checkSourceStamp({ authoredAt: new Date(Number.NaN) }, NOW)).toBe('authored-at-invalid')
  })

  it('accepts any visible id up to the bound, because the id is opaque', () => {
    expect(
      checkSourceStamp({ sourceRevision: 'x'.repeat(SOURCE_REVISION_MAX_LENGTH) }, NOW),
    ).toBeNull()
    expect(checkSourceStamp({ sourceRevision: 'r1234@trunk' }, NOW)).toBeNull()
  })

  it.each([
    ['empty', ''],
    ['over the bound', 'x'.repeat(SOURCE_REVISION_MAX_LENGTH + 1)],
    ['a line break, which would forge a trailer', `${COMMIT}\nQuill-Document-Id: x`],
    ['a space', 'two words'],
    ['a control character', 'abc\u0000'],
    ['non-ASCII', 'café'],
  ])('refuses a source revision with %s', (_, sourceRevision) => {
    expect(checkSourceStamp({ sourceRevision }, NOW)).toBe('source-revision-invalid')
  })
})
