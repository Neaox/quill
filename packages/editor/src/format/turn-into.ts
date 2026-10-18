import {
  BulletListIcon,
  CalloutIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  NumberedListIcon,
  ParagraphIcon,
  QuoteIcon,
  TaskListIcon,
} from '@quill/ui'
import type { IconProps } from '@quill/ui'
import { lift, setBlockType, wrapIn } from '@tiptap/pm/commands'
import type { Node as PMNode } from '@tiptap/pm/model'
import { liftListItem, wrapInList } from '@tiptap/pm/schema-list'
import type { Command, EditorState, Transaction } from '@tiptap/pm/state'
import type { ComponentType } from 'react'

import { nodeType } from '../schema/node-type.ts'

/**
 * "Turn into": the block the caret is in becomes another kind of block, its
 * words kept (the selection toolbar, the context menu).
 *
 * The block is first taken out of whatever list, quote or callout holds it,
 * and then made the new kind, all in one transaction, so one undo puts it
 * back exactly. Nothing else about the document moves.
 */

export const TURN_INTO = [
  'paragraph',
  'heading-1',
  'heading-2',
  'heading-3',
  'bullet-list',
  'numbered-list',
  'task-list',
  'quote',
  'callout',
] as const

export type TurnIntoTarget = (typeof TURN_INTO)[number]

export const TURN_INTO_LABELS: Readonly<Record<TurnIntoTarget, string>> = {
  paragraph: 'Text',
  'heading-1': 'Heading 1',
  'heading-2': 'Heading 2',
  'heading-3': 'Heading 3',
  'bullet-list': 'Bulleted list',
  'numbered-list': 'Numbered list',
  'task-list': 'Task list',
  quote: 'Quote',
  callout: 'Callout',
}

/** Each kind's glyph, the one the slash menu shows for the same block. */
export const TURN_INTO_ICONS: Readonly<Record<TurnIntoTarget, ComponentType<IconProps>>> = {
  paragraph: ParagraphIcon,
  'heading-1': Heading1Icon,
  'heading-2': Heading2Icon,
  'heading-3': Heading3Icon,
  'bullet-list': BulletListIcon,
  'numbered-list': NumberedListIcon,
  'task-list': TaskListIcon,
  quote: QuoteIcon,
  callout: CalloutIcon,
}

const LISTS: Readonly<Record<string, TurnIntoTarget>> = {
  bulletList: 'bullet-list',
  orderedList: 'numbered-list',
  taskList: 'task-list',
}

/** The text blocks "Turn into" knows, by node name or heading level. Deeper headings are left alone. */
const TEXT_KINDS: Readonly<Record<string, TurnIntoTarget>> = {
  paragraph: 'paragraph',
  'heading-1': 'heading-1',
  'heading-2': 'heading-2',
  'heading-3': 'heading-3',
}

function isCallout(node: PMNode): boolean {
  return node.type.name === 'containerDirective' && node.attrs['name'] === 'callout'
}

/** What the block the caret is in is now, in "Turn into"'s terms; undefined for anything else. */
export function currentKind(state: EditorState): TurnIntoTarget | undefined {
  const { $from } = state.selection
  const block = $from.parent
  if (!block.isTextblock || block.type.spec.code === true) return undefined
  const textKind =
    TEXT_KINDS[
      block.type.name === 'heading' ? `heading-${String(block.attrs['level'])}` : block.type.name
    ]
  if (textKind === undefined) return undefined
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    const wrapper = $from.node(depth)
    const list = LISTS[wrapper.type.name]
    if (list !== undefined) return list
    if (isCallout(wrapper)) return 'callout'
    if (wrapper.type.name === 'blockquote') return 'quote'
    if (wrapper.type.name !== 'listItem' && wrapper.type.name !== 'taskItem') break
  }
  return textKind
}

/** Runs commands one after another as one transaction: one undo step, whatever they did. */
export function sequence(...commands: readonly Command[]): Command {
  return (state, dispatch) => {
    let current = state
    const steps: Transaction[] = []
    // Each but the last may have nothing to do; the last is the point, and
    // when it cannot act nothing is done at all.
    let last = false
    for (const command of commands) {
      last = command(current, (tr) => {
        steps.push(tr)
        current = current.apply(tr)
      })
    }
    if (!last) return false
    if (dispatch !== undefined) {
      const tr = state.tr
      for (const step of steps.flatMap((each) => each.steps)) tr.step(step)
      dispatch(
        tr
          .setSelection(current.selection.map(tr.doc, tr.mapping.slice(tr.steps.length)))
          .scrollIntoView(),
      )
    }
    return true
  }
}

/** Nothing to take the block out of. */
const stay: Command = () => false

/** How the block is taken out of the wrapper around it, if it is one "Turn into" unwraps. */
function unwrapping(wrapper: PMNode): Command {
  const name = wrapper.type.name
  if (name === 'listItem' || name === 'taskItem') return liftListItem(wrapper.type)
  return name === 'blockquote' || isCallout(wrapper) ? lift : stay
}

/** Takes the caret's block out of the lists, quotes and callouts around it. */
const unwrap: Command = (state, dispatch) => {
  let current = state
  const once = (): boolean => {
    const { $from } = current.selection
    return unwrapping($from.node(Math.max(0, $from.depth - 1)))(current, (tr) => {
      dispatch?.(tr)
      current = current.apply(tr)
    })
  }
  let changed = false
  // Bounded: a block is never nested deeper than this in anything a writer made.
  for (let guard = 0; guard < 8 && once(); guard += 1) changed = true
  return changed
}

function make(target: TurnIntoTarget): Command {
  return (state, dispatch, view) => {
    const { schema } = state
    switch (target) {
      case 'paragraph':
        // A list item lifted out of its list is already a paragraph: done.
        return (
          setBlockType(nodeType(schema, 'paragraph'))(state, dispatch, view) ||
          state.selection.$from.parent.type.name === 'paragraph'
        )
      case 'heading-1':
      case 'heading-2':
      case 'heading-3':
        return setBlockType(nodeType(schema, 'heading'), { level: Number(target.slice(-1)) })(
          state,
          dispatch,
          view,
        )
      case 'bullet-list':
        return wrapInList(nodeType(schema, 'bulletList'))(state, dispatch, view)
      case 'numbered-list':
        return wrapInList(nodeType(schema, 'orderedList'))(state, dispatch, view)
      case 'task-list':
        return wrapInList(nodeType(schema, 'taskList'))(state, dispatch, view)
      case 'quote':
        return wrapIn(nodeType(schema, 'blockquote'))(state, dispatch, view)
      case 'callout':
        return wrapIn(nodeType(schema, 'containerDirective'), {
          name: 'callout',
          attributes: { type: 'note' },
        })(state, dispatch, view)
    }
  }
}

/**
 * Turns the caret's block into `target`. A heading in a list becomes a
 * paragraph first, because a list item opens with one, so turning text into a
 * list always works.
 */
export function turnInto(target: TurnIntoTarget): Command {
  return (state, dispatch, view) => {
    const kind = currentKind(state)
    if (kind === undefined || kind === target) return false
    const wrapping = target.endsWith('-list')
    const plain = wrapping ? [setBlockType(nodeType(state.schema, 'paragraph'))] : []
    return sequence(unwrap, ...plain, make(target))(state, dispatch, view)
  }
}
