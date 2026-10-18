import type { Root } from 'mdast'
import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { mergeDocuments } from '../merge/merge-documents.ts'
import { compareDocuments } from './compare.ts'
import {
  attributeChanges,
  NO_AUTHORSHIP,
  readAuthorship,
  REMOVALS_KEPT,
  removedBy,
  stampEdit,
  writtenBy,
} from './authorship.ts'

const document = (...blocks: string[]): Root => parseDocument(`${blocks.join('\n\n')}\n`).ast
const ADA = { by: 'ada', at: '2026-01-01T10:00:00.000Z' }
const GRACE = { by: 'grace', at: '2026-01-02T10:00:00.000Z' }

const PUBLISHED = document('First block here.', 'Second block here.', 'Third block here.')

/** The block at a place, which a test knows is there. */
function at(tree: Root, index: number) {
  const block = tree.children[index]
  if (block === undefined) throw new Error(`no block ${String(index)}`)
  return block
}

describe('who wrote what is waiting in a draft', () => {
  it('stamps what a save added and what it edited, and nothing else', () => {
    const saved = document(
      'First block here.',
      'Second block here, edited.',
      'Third block here.',
      'Fourth block here.',
    )

    const ledger = stampEdit(undefined, PUBLISHED, saved, ADA)

    expect(writtenBy(ledger, at(saved, 0))).toBeUndefined()
    expect(writtenBy(ledger, at(saved, 1))).toEqual(ADA)
    expect(writtenBy(ledger, at(saved, 2))).toBeUndefined()
    expect(writtenBy(ledger, at(saved, 3))).toEqual(ADA)
  })

  it('keeps each person’s stamp through the next person’s save', () => {
    const byAda = document('First block here.', 'Second block here, edited.', 'Third block here.')
    const byGrace = document(
      'First block here.',
      'Second block here, edited.',
      'Third block here.',
      'Fourth block here.',
    )

    const ledger = stampEdit(stampEdit(undefined, PUBLISHED, byAda, ADA), byAda, byGrace, GRACE)

    expect(writtenBy(ledger, at(byGrace, 1))).toEqual(ADA)
    expect(writtenBy(ledger, at(byGrace, 3))).toEqual(GRACE)
  })

  it('gives a block to whoever edited it last', () => {
    const byAda = document('First block here.', 'Second block here, edited.', 'Third block here.')
    const byGrace = document(
      'First block here.',
      'Second block here, edited again.',
      'Third block here.',
    )

    const ledger = stampEdit(stampEdit(undefined, PUBLISHED, byAda, ADA), byAda, byGrace, GRACE)

    expect(writtenBy(ledger, at(byGrace, 1))).toEqual(GRACE)
    expect(Object.keys(ledger.blocks)).toHaveLength(1)
  })

  it('follows a block that was moved', () => {
    const byAda = document('First block here.', 'Second block here, edited.', 'Third block here.')
    const moved = document('Second block here, edited.', 'First block here.', 'Third block here.')

    const ledger = stampEdit(stampEdit(undefined, PUBLISHED, byAda, ADA), byAda, moved, GRACE)

    expect(writtenBy(ledger, at(moved, 0))).toEqual(ADA)
  })

  it('remembers who took a block out', () => {
    const without = document('First block here.', 'Third block here.')

    const ledger = stampEdit(undefined, PUBLISHED, without, GRACE)

    expect(removedBy(ledger, at(PUBLISHED, 1))).toEqual(GRACE)
    expect(removedBy(ledger, at(PUBLISHED, 0))).toBeUndefined()
  })

  it('forgets a removal when the block comes back', () => {
    const without = document('First block here.', 'Third block here.')

    const ledger = stampEdit(
      stampEdit(undefined, PUBLISHED, without, GRACE),
      without,
      PUBLISHED,
      ADA,
    )

    expect(removedBy(ledger, at(PUBLISHED, 1))).toBeUndefined()
  })

  it('remembers only so many removals, the newest', () => {
    let tree = document(
      ...Array.from({ length: REMOVALS_KEPT + 5 }, (_, n) => `Block number ${String(n)} here.`),
    )
    let ledger = stampEdit(undefined, document(), tree, ADA)
    for (const _ of Array.from({ length: REMOVALS_KEPT + 5 })) {
      const next = { ...tree, children: tree.children.slice(1) }
      ledger = stampEdit(ledger, tree, next, GRACE)
      tree = next
    }

    expect(ledger.removed).toHaveLength(REMOVALS_KEPT)
  })

  it('says nothing for a draft that has no ledger', () => {
    expect(writtenBy(undefined, at(PUBLISHED, 0))).toBeUndefined()
    expect(removedBy(undefined, at(PUBLISHED, 0))).toBeUndefined()
  })
})

describe('reading a ledger back', () => {
  it('reads what it wrote', () => {
    const ledger = stampEdit(undefined, PUBLISHED, document('Only block here.'), ADA)

    expect(readAuthorship(JSON.parse(JSON.stringify(ledger)))).toEqual(ledger)
  })

  it('reads nothing from a version it does not know, or from what is not a ledger', () => {
    expect(readAuthorship({ ...NO_AUTHORSHIP, version: 2 })).toBeUndefined()
    expect(readAuthorship(null)).toBeUndefined()
    expect(readAuthorship('ledger')).toBeUndefined()
    expect(readAuthorship({ version: 1 })).toBeUndefined()
  })

  it('drops entries that are not stamps rather than refusing the whole ledger', () => {
    const read = readAuthorship({
      version: 1,
      blocks: { good: ADA, bad: { by: 3 } },
      removed: [{ ...GRACE, key: 'k' }, { by: 'x' }],
    })

    expect(read).toEqual({ version: 1, blocks: { good: ADA }, removed: [{ ...GRACE, key: 'k' }] })
  })
})

describe('who made each change of a comparison', () => {
  const published = document('First block here.', 'Second block here.', 'Alpha beta gamma delta.')
  const byAda = document(
    'First block here.',
    'Second block here, edited.',
    'Alpha beta gamma delta.',
    'Zebra quartz vortex fresh.',
  )
  const byGrace = document(
    'First block here.',
    'Second block here, edited.',
    'Zebra quartz vortex fresh.',
  )

  function context(draft: Root) {
    return { draft, after: draft, comparison: compareDocuments(published, draft) }
  }

  it('names who edited, who added and who removed', () => {
    const ledger = stampEdit(stampEdit(undefined, published, byAda, ADA), byAda, byGrace, GRACE)

    const { comparison } = context(byGrace)
    const named = attributeChanges(context(byGrace), ledger)

    const stamps = Object.fromEntries(
      comparison.changes.map(({ id, change }) => [change, named.get(id)]),
    )
    expect(stamps).toEqual({ changed: ADA, added: ADA, removed: GRACE })
  })

  it('names no one for a change the ledger has never heard of', () => {
    expect(attributeChanges(context(byAda), NO_AUTHORSHIP).size).toBe(0)
  })

  it('names no one without a ledger', () => {
    expect(attributeChanges(context(byAda), undefined).size).toBe(0)
  })

  it('names no one for changes the ledger has no record of', () => {
    expect(attributeChanges(context(byAda), NO_AUTHORSHIP).size).toBe(0)
  })

  it('names no one for a draft that is not what was compared', () => {
    const ledger = stampEdit(undefined, published, byAda, ADA)
    const drifted = { ...context(byAda), draft: document('Something else entirely.') }

    expect(attributeChanges(drifted, ledger).size).toBe(0)
  })
})

describe('who wrote what, once offline changes are merged in', () => {
  it('keeps the stamps of what the draft already had and stamps what the merge brought', () => {
    // Grace saved an edit to the second block while Ada was offline editing the third.
    const theirs = document('First block here.', 'Second block, by Grace.', 'Third block here.')
    const ledger = stampEdit(undefined, PUBLISHED, theirs, GRACE)
    const mine = document('First block here.', 'Second block here.', 'Third block, by Ada.')

    const { merged, conflicts } = mergeDocuments(PUBLISHED, mine, theirs)
    // Ada's session saves the merge over the draft as Grace left it.
    const after = stampEdit(ledger, theirs, merged, ADA)

    expect(conflicts).toEqual([])
    expect(writtenBy(after, at(merged, 1))).toEqual(GRACE)
    expect(writtenBy(after, at(merged, 2))).toEqual(ADA)
    expect(writtenBy(after, at(merged, 0))).toBeUndefined()
  })

  it('names the author of a block the merge took out by whoever removed it offline', () => {
    const theirs = document('First block here.', 'Second block, by Grace.', 'Third block here.')
    const ledger = stampEdit(undefined, PUBLISHED, theirs, GRACE)
    const mine = document('Second block here.', 'Third block here.')

    const { merged } = mergeDocuments(PUBLISHED, mine, theirs)
    const after = stampEdit(ledger, theirs, merged, ADA)

    expect(removedBy(after, at(PUBLISHED, 0))).toEqual(ADA)
    expect(writtenBy(after, at(merged, 0))).toEqual(GRACE)
  })
})
