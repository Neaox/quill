import { describe, expect, it } from 'vitest'

import { createFakeDocumentFormat } from '../test-support/fake-document-format.ts'
import { stampDraftAuthorship } from './stamp-draft-authorship.ts'

const format = createFakeDocumentFormat()
const NOW = new Date('2026-01-01T00:00:00.000Z')
const draft = (body: string) => ({ version: 1, frontMatter: {}, ast: { body } })

describe('stampDraftAuthorship', () => {
  it('stamps a save over what the draft held, as whoever saved', () => {
    const stamped = stampDraftAuthorship(
      format,
      { ast: draft('one'), authorship: null },
      draft('two'),
      { by: 'ada', at: NOW },
    )

    expect(stamped).toEqual({ version: 1, body: 'two', by: 'ada', at: NOW.toISOString() })
  })

  it('leaves the record alone when there is nothing before it to compare with', () => {
    expect(stampDraftAuthorship(format, null, draft('two'), { by: 'ada', at: NOW })).toBeUndefined()
  })

  it('leaves the record alone when either side is not a draft it can read', () => {
    const stamp = { by: 'ada', at: NOW }

    expect(
      stampDraftAuthorship(format, { ast: 'junk', authorship: null }, draft('x'), stamp),
    ).toBeUndefined()
    expect(
      stampDraftAuthorship(format, { ast: draft('one'), authorship: null }, 'junk', stamp),
    ).toBeUndefined()
  })
})
