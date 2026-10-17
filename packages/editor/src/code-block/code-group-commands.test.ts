import { describe, expect, it } from 'vitest'
import type { EditorState, Transaction } from '@tiptap/pm/state'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import {
  addTab,
  moveTab,
  removeTab,
  renameTab,
  setTabLanguage,
  tabName,
} from './code-group-commands.ts'
import { codeGroupItems } from './code-group-slash.ts'

const harness = createEditorTestHarness()

/** A group with no labels and no languages, after a paragraph: what the slash menu makes. */
const UNNAMED = 'Intro.\n\n:::code-group\n```\na\n```\n```\nb\n```\n:::\n'
const NAMED = 'Intro.\n\n:::code-group\n```ts [Node]\na\n```\n```py\nb\n```\n:::\n'

/** Where the group starts: after the paragraph `Intro.`, which is eight positions long. */
const GROUP = 8

function apply(
  state: EditorState,
  command: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean,
) {
  let next = state
  const done = command(state, (tr) => {
    next = state.apply(tr)
  })
  return { done, state: next, markdown: harness.read(documentToMdast(next.doc).tree) }
}

describe('code group commands', () => {
  it('act only on a group, and only on a tab it has', () => {
    const state = harness.state(NAMED)
    expect(addTab(0)(state)).toBe(false)
    expect(renameTab(0, 0, 'x')(state)).toBe(false)
    expect(renameTab(GROUP, 5, 'x')(state)).toBe(false)
    expect(removeTab(0, 0)(state)).toBe(false)
    expect(removeTab(GROUP, 5)(state)).toBe(false)
    expect(removeTab(GROUP, 0)(state)).toBe(true)
    expect(moveTab(0, 0, 1)(state)).toBe(false)
    expect(moveTab(GROUP, 1, 1)(state)).toBe(false)
    expect(moveTab(GROUP, 0, 5)(state)).toBe(false)
    expect(moveTab(GROUP, 0, -1)(state)).toBe(false)
    expect(moveTab(GROUP, 4, 0)(state)).toBe(false)
    expect(renameTab(GROUP, 0, 'Deno')(state)).toBe(true)
    expect(moveTab(GROUP, 0, 1)(state)).toBe(true)
    expect(setTabLanguage(0, 0, 'go')(state)).toBe(false)
    expect(setTabLanguage(GROUP, 5, 'go')(state)).toBe(false)
    expect(setTabLanguage(GROUP, 0, 'ts')(state)).toBe(false)
    expect(setTabLanguage(GROUP, 1, null)(state)).toBe(true)
  })

  it('names a tab with no language as text once it is named, and leaves it be when unnamed', () => {
    const named = apply(harness.state(UNNAMED), renameTab(GROUP, 0, 'First'))
    expect(named.markdown).toContain('```text [First]\na\n```')
    expect(apply(harness.state(UNNAMED), renameTab(GROUP, 0, '')).done).toBe(false)

    // A label on a block with no language, as the editor could hold one: taken
    // away, the block is left as plain as it was.
    const plain = harness.state(UNNAMED)
    const labelled = plain.apply(plain.tr.setNodeAttribute(GROUP + 1, 'meta', '[Old]'))
    const cleared = apply(labelled, renameTab(GROUP, 0, ''))
    expect(cleared.state.doc.child(1).child(0).attrs).toMatchObject({ language: null, meta: null })
  })

  it('takes a name away, handing the tab back to its language', () => {
    const renamed = apply(harness.state(NAMED), renameTab(GROUP, 0, ''))
    expect(renamed.markdown).toContain('```ts\na\n```')
  })

  it('names tabs as the reader does', () => {
    const { doc } = harness.state(NAMED)
    const group = doc.child(1)
    expect([tabName(group.child(0), 0), tabName(group.child(1), 1)]).toEqual(['Node', 'Python'])
    const unnamed = harness.state(UNNAMED).doc.child(1)
    expect(tabName(unnamed.child(1), 1)).toBe('Code 2')
  })

  it('is offered by the slash menu, which makes two empty tabs', () => {
    const [item] = codeGroupItems.items({})
    if (item === undefined) throw new Error('No item.')
    const state = harness.state('\n')
    let next = state
    item.run({
      state,
      dispatch: (tr) => {
        next = state.apply(tr)
      },
      request: () => undefined,
      pick: () => undefined,
    })
    const group = next.doc.firstChild
    expect(group?.type.name).toBe('codeGroup')
    expect(group?.childCount).toBe(2)
    expect(next.selection.$from.parent.type.name).toBe('codeBlock')
  })
})
