import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { stringifyMdast } from '../pipeline/processor.ts'
import { compareDocuments } from './compare.ts'
import { revertChanges } from './revert.ts'

describe('putting back a block that was removed from the end of a document', () => {
  it('puts it back after the last block, where nothing followed it', () => {
    const after = parseDocument('Keep this.\n').ast
    const comparison = compareDocuments(parseDocument('Keep this.\n\nThe last block.\n').ast, after)
    const ids = comparison.changes.map(({ id }) => id)

    const reverted = revertChanges({ draft: after, after, comparison }, ids)

    expect(stringifyMdast(reverted)).toBe('Keep this.\n\nThe last block.\n')
  })
})
