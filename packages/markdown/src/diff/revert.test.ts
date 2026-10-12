import type { RootContent } from 'mdast'
import { describe, expect, it } from 'vitest'

import { parseDocument } from '../pipeline/parse-document.ts'
import { stringifyMdast } from '../pipeline/processor.ts'
import { compareDocuments } from './compare.ts'
import { revertChanges, revertibleChanges } from './revert.ts'

const document = (...blocks: string[]): string => `${blocks.join('\n\n')}\n`

const OLDER = document(
  '# Runbook',
  'Restart the queue first.',
  'Check the dashboard for errors.',
  'Tell the on-call engineer.',
)

const NEWER = document(
  '# Runbook',
  'Restart the queue first, then wait.',
  'Tell the on-call engineer.',
  'Page the manager.',
)

function setUp(older: string, newer: string, draft = newer) {
  const before = parseDocument(older).ast
  const after = parseDocument(newer).ast
  const comparison = compareDocuments(before, after)
  const context = { draft: parseDocument(draft).ast, after, comparison }
  return { comparison, context, written: (tree = context.draft) => stringifyMdast(tree) }
}

const idOf = (
  comparison: ReturnType<typeof compareDocuments>,
  change: 'added' | 'removed' | 'changed' | 'moved',
): string => {
  const found = comparison.changes.find((each) => each.change === change)
  if (found === undefined) throw new Error(`no ${change} change`)
  return found.id
}

describe('reverting changes to a draft', () => {
  it('puts a changed block back as it was', () => {
    const { comparison, context, written } = setUp(OLDER, NEWER)

    const reverted = revertChanges(context, [idOf(comparison, 'changed')])

    expect(written(reverted)).toContain('Restart the queue first.\n')
    expect(written(reverted)).not.toContain('then wait')
    expect(written(reverted)).toContain('Page the manager.')
  })

  it('takes out a block that was added', () => {
    const { comparison, context, written } = setUp(OLDER, NEWER)

    const reverted = revertChanges(context, [idOf(comparison, 'added')])

    expect(written(reverted)).not.toContain('Page the manager.')
    expect(written(reverted)).toContain('then wait')
  })

  it('puts back a block that was removed, where it was', () => {
    const { comparison, context, written } = setUp(OLDER, NEWER)

    const reverted = revertChanges(context, [idOf(comparison, 'removed')])

    expect(written(reverted).indexOf('Check the dashboard')).toBeGreaterThan(
      written(reverted).indexOf('then wait'),
    )
    expect(written(reverted).indexOf('Check the dashboard')).toBeLessThan(
      written(reverted).indexOf('Tell the on-call'),
    )
  })

  it('reverts several at once, and all of them is the older document', () => {
    const { comparison, context, written } = setUp(OLDER, NEWER)

    const reverted = revertChanges(
      context,
      comparison.changes.map(({ id }) => id),
    )

    expect(written(reverted)).toBe(written(parseDocument(OLDER).ast))
  })

  it('puts back several removals in the order they had', () => {
    const { comparison, context, written } = setUp(
      document('One here.', 'Two here.', 'Three here.', 'Four here.'),
      document('One here.', 'Four here.'),
    )

    const reverted = revertChanges(
      context,
      comparison.changes.map(({ id }) => id),
    )

    expect(written(reverted)).toBe(document('One here.', 'Two here.', 'Three here.', 'Four here.'))
  })

  it('leaves the rest of the draft exactly as it is', () => {
    const { comparison, context } = setUp(OLDER, NEWER)

    const reverted = revertChanges(context, [idOf(comparison, 'added')])

    expect(reverted.children.slice(0, 3)).toEqual(context.draft.children.slice(0, 3))
  })

  it('does not touch the draft it was given', () => {
    const { comparison, context } = setUp(OLDER, NEWER)
    const before = structuredClone(context.draft)

    revertChanges(
      context,
      comparison.changes.map(({ id }) => id),
    )

    expect(context.draft).toEqual(before)
  })

  it('names the changes that can be reverted: all but moves', () => {
    const { comparison, context } = setUp(
      document('First one here.', 'Second one here.', 'Third one here.', 'Fourth one here.'),
      document('Fourth one here.', 'First one here.', 'Second one here.', 'Third one here.'),
    )

    expect(comparison.changes.map(({ change }) => change)).toContain('moved')
    const revertible = revertibleChanges(context)

    for (const { id, change } of comparison.changes) {
      expect(revertible.has(id)).toBe(change !== 'moved')
    }
  })

  it('names none when the draft is not what was compared, because where things are is not known', () => {
    const { comparison, context } = setUp(
      OLDER,
      NEWER,
      document('# Runbook', 'An extra block that is not in the comparison.', NEWER),
    )

    expect(comparison.changes.length).toBeGreaterThan(0)
    expect(revertibleChanges(context).size).toBe(0)
  })

  it('names only the changes whose block is the one compared', () => {
    const { comparison, context } = setUp(
      OLDER,
      NEWER,
      NEWER.replace('Page the manager.', 'Page the director.'),
    )

    const revertible = revertibleChanges(context)

    expect(revertible.has(idOf(comparison, 'added'))).toBe(false)
    expect(revertible.has(idOf(comparison, 'changed'))).toBe(true)
  })

  it('counts blocks without the front matter, which a draft keeps apart from its tree', () => {
    const matter = ['---', 'title: Runbook', '---'].join('\n')
    const { comparison, context, written } = setUp(
      document(matter, ...OLDER.trim().split('\n\n')),
      document(matter, ...NEWER.trim().split('\n\n')),
    )
    const bare = {
      ...context,
      draft: {
        ...context.draft,
        children: context.draft.children.filter(({ type }) => type !== 'yaml'),
      },
    }

    const reverted = revertChanges(bare, [idOf(comparison, 'added')])

    expect(written(reverted)).not.toContain('Page the manager.')
    expect(written(reverted)).toContain('then wait')
    expect(reverted.children.some(({ type }) => type === 'yaml')).toBe(false)
  })

  it('puts a block back where its links are written differently in the draft, which a publish rewrites', () => {
    const { comparison, context } = setUp(
      document('# Runbook', 'Read the [guide](/guide) first.', 'Tell the on-call engineer.'),
      document(
        '# Runbook',
        'Read the [guide](/guide) first, then wait.',
        'Tell the on-call engineer.',
      ),
      document(
        '# Runbook',
        'Read the [guide](/d/the-guide-k7m3q9v2rt) first, then wait.',
        'Tell the on-call engineer.',
      ),
    )

    expect(revertibleChanges(context).has(idOf(comparison, 'changed'))).toBe(true)
  })

  it('counts past the editor’s blank lines, and leaves them where they are', () => {
    const { comparison, context, written } = setUp(OLDER, NEWER)
    const blank: RootContent = { type: 'paragraph', children: [] }
    const spaced = {
      ...context,
      draft: {
        ...context.draft,
        children: context.draft.children.flatMap((node) => [node, blank]),
      },
    }
    expect(revertibleChanges(spaced).size).toBe(comparison.changes.length)

    const reverted = revertChanges(spaced, [idOf(comparison, 'added')])

    expect(written(reverted)).not.toContain('Page the manager.')
    expect(
      reverted.children.filter((node) => node.type === 'paragraph' && node.children.length === 0),
    ).toHaveLength(context.draft.children.length)
  })

  it('ignores an id that names nothing, or a change that cannot be reverted', () => {
    const { context, written } = setUp(OLDER, NEWER)

    expect(written(revertChanges(context, ['c99']))).toBe(written())
  })
})
