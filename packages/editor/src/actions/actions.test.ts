import { AllSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { describe, expect, it, vi } from 'vitest'

import { transactionOf } from '../format/transactions.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import { BLOCK_GROUP, commentAction, commentGroup } from './block-actions.ts'
import { CALLOUT_TONES, CALLOUT_VARIANT_GROUP } from './callout-actions.ts'
import { contextMenuGroups } from './context-groups.ts'
import { actionState, availableGroups } from './editor-action.ts'
import type { ActionGroup, EditorAction } from './editor-action.ts'
import { linkActions, linkGroup } from './link-actions.ts'
import { TABLE_COLUMN_GROUP, TABLE_ROW_GROUP } from './table-actions.ts'
import { MARK_ACTIONS, MARK_GROUP, STYLE_GROUP } from './text-actions.ts'

const harness = createEditorTestHarness()

function stateAt(markdown: string, from: number, to = from): EditorState {
  const opened = harness.state(markdown)
  return opened.apply(opened.tr.setSelection(TextSelection.create(opened.doc, from, to)))
}

function action(group: ActionGroup, id: string): EditorAction {
  const found = group.actions.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`The "${group.id}" group has no "${id}" action.`)
  return found
}

describe('whether an action is available', () => {
  const state = stateAt('Some text.\n', 1, 5)

  it('asks the command, which is how a ProseMirror command says "would this do anything?"', () => {
    expect(actionState(action(MARK_GROUP, 'bold'), state)).toEqual({
      enabled: true,
      checked: false,
    })
    expect(actionState(action(TABLE_ROW_GROUP, 'row-above'), state).enabled).toBe(false)
  })

  it('never calls the choice already in force unavailable', () => {
    const plain = stateAt('Some text.\n', 3)
    const current = action(STYLE_GROUP, 'paragraph')
    expect(current.command(plain)).toBe(false)
    expect(actionState(current, plain)).toEqual({ enabled: true, checked: true })
  })

  it('keeps only the groups with something to do', () => {
    expect(availableGroups([MARK_GROUP, TABLE_ROW_GROUP, TABLE_COLUMN_GROUP], state)).toEqual([
      MARK_GROUP,
    ])
    expect(availableGroups([TABLE_ROW_GROUP], state)).toEqual([])
  })
})

describe('the mark actions', () => {
  it('pair each mark with the action that toggles it, in the order of the registry', () => {
    expect(MARK_ACTIONS.map(({ mark, action: each }) => [mark.name, each.id])).toEqual([
      ['bold', 'bold'],
      ['italic', 'italic'],
      ['strike', 'strike'],
      ['code', 'code'],
    ])
    expect(MARK_GROUP.actions).toEqual(MARK_ACTIONS.map(({ action: each }) => each))
  })

  it('are switches, so a surface shows whether each is on', () => {
    expect(MARK_GROUP.actions.every((each) => each.kind === 'check')).toBe(true)
  })
})

describe('the text style actions', () => {
  it('are choices, one of which is current', () => {
    expect(STYLE_GROUP.actions.every((each) => each.kind === 'radio')).toBe(true)
    const checked = STYLE_GROUP.actions.filter((each) => each.isChecked?.(stateAt('## H\n', 2)))
    expect(checked.map((each) => each.id)).toEqual(['heading-2'])
  })

  it('carry the key binding of the style, when it has one', () => {
    expect(action(STYLE_GROUP, 'heading-1').keys).toBe('Mod-Alt-1')
    expect(action(STYLE_GROUP, 'blockquote').keys).toBeUndefined()
  })
})

describe('the callout actions', () => {
  it('give every variant a tone, so a menu can draw its colour beside its name', () => {
    expect(Object.keys(CALLOUT_TONES).toSorted()).toEqual([
      'caution',
      'important',
      'info',
      'note',
      'tip',
      'warning',
    ])
    expect(CALLOUT_VARIANT_GROUP.actions.every((each) => each.tone !== undefined)).toBe(true)
  })
})

describe('the link actions', () => {
  const ui = { edit: vi.fn<() => void>() }

  it('offer to edit a selection or a link, and nothing for a caret in plain text', () => {
    const { edit } = linkActions(ui)
    expect(edit.command(stateAt('Some text.\n', 1, 5))).toBe(true)
    expect(edit.command(stateAt('Some text.\n', 3))).toBe(false)
    expect(edit.command(stateAt('[a link](/x)\n', 3))).toBe(true)
  })

  it('open the box only when dispatched, never when merely asked about', () => {
    const { edit } = linkActions(ui)
    const state = stateAt('Some text.\n', 1, 5)
    edit.command(state)
    expect(ui.edit).not.toHaveBeenCalled()
    edit.command(state, () => {})
    expect(ui.edit).toHaveBeenCalledTimes(1)
  })

  it('apply only where there is a link to open, copy or remove', () => {
    const { open, copy, remove } = linkActions(ui)
    const plain = stateAt('Some text.\n', 3)
    expect([open, copy, remove].map((each) => each.command(plain))).toEqual([false, false, false])
    const inLink = stateAt('[a link](/x)\n', 3)
    expect([open, copy, remove].map((each) => each.command(inLink))).toEqual([true, true, true])
  })

  it('make a group of the four, with removal set apart as destructive', () => {
    const group = linkGroup(ui)
    expect(group.actions.map((each) => each.id)).toEqual([
      'link-edit',
      'link-open',
      'link-copy',
      'link-remove',
    ])
    expect(group.actions.at(-1)?.destructive).toBe(true)
  })
})

describe('the block and comment actions', () => {
  it('move, duplicate and delete, with deletion marked as destructive', () => {
    expect(BLOCK_GROUP.actions.map((each) => each.id)).toEqual([
      'move-up',
      'move-down',
      'duplicate',
      'delete',
    ])
    expect(BLOCK_GROUP.actions.map((each) => each.destructive)).toEqual([false, false, false, true])
  })

  it('exist only when somebody is listening for comments', () => {
    expect(commentAction(undefined)).toBeUndefined()
    expect(commentGroup(undefined).actions).toEqual([])
    expect(commentGroup(() => {}).actions).toHaveLength(1)
  })

  it('comment on the selection, or on the whole block for a caret, and only when dispatched', () => {
    const onComment = vi.fn<(request: { from: number; to: number; text: string }) => void>()
    const comment = commentAction(onComment)
    if (comment === undefined) throw new Error('There is no comment action.')

    expect(comment.command(stateAt('Some text.\n', 1, 5))).toBe(true)
    expect(onComment).not.toHaveBeenCalled()

    comment.command(stateAt('Some text.\n', 1, 5), () => {})
    expect(onComment).toHaveBeenLastCalledWith({ from: 1, to: 5, text: 'Some' })
    comment.command(stateAt('Some text.\n', 3), () => {})
    expect(onComment).toHaveBeenLastCalledWith({ from: 0, to: 12, text: 'Some text.' })
  })

  it('decline when the selection is in no block, as a select-all is not', () => {
    const comment = commentAction(() => {})
    const opened = harness.state('Some text.\n')
    const all = opened.apply(opened.tr.setSelection(new AllSelection(opened.doc)))
    expect(comment?.command(all)).toBe(false)
  })
})

describe('the table actions outside a table', () => {
  it('do nothing, including the ones that select a row or a column', () => {
    const outside = harness.state('Just text.\n')
    for (const group of [TABLE_ROW_GROUP, TABLE_COLUMN_GROUP]) {
      expect(group.actions.map((each) => transactionOf(each.command, outside))).toEqual(
        group.actions.map(() => null),
      )
    }
  })
})

describe('the context menu’s groups', () => {
  const ui = { edit: () => {}, onComment: () => {} }
  const ids = (state: EditorState): string[] =>
    contextMenuGroups(state, ui).map((group) => group.id)

  it('are a function of where the selection is', () => {
    expect(ids(stateAt('Some text.\n', 1, 5))).toEqual([
      'clipboard',
      'link',
      'marks',
      'styles',
      'callout-wrap',
      'block',
      'comment',
    ])
    expect(ids(stateAt('Some text.\n', 3))).toEqual(['styles', 'block', 'comment'])
  })

  it('offer how a link is shown wherever the caret is in one', () => {
    expect(ids(stateAt('[a link](/x)\n', 3))).toContain('link-display')
    expect(ids(stateAt('Some text.\n', 3))).not.toContain('link-display')
  })

  it('leave out the comment group when nobody is listening', () => {
    expect(
      contextMenuGroups(stateAt('Some text.\n', 3), { edit: () => {} }).map((g) => g.id),
    ).toEqual(['styles', 'block'])
  })

  it('offer a table its own groups and no text styles for a cell', () => {
    const table = harness.state('| a | b |\n| - | - |\n| 1 | 2 |\n')
    const inCell = table.apply(table.tr.setSelection(TextSelection.create(table.doc, 4)))
    expect(ids(inCell)).toEqual([
      'table-rows',
      'table-columns',
      'table-align',
      'table',
      'block',
      'comment',
    ])
  })
})
