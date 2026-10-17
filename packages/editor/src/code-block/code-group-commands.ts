import { codeLabel, hasTabAttribute, withTabLabel } from '@quill/markdown'
import { closeHistory } from '@tiptap/pm/history'
import { Fragment } from '@tiptap/pm/model'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { Command, Transaction } from '@tiptap/pm/state'
import { Selection, TextSelection } from '@tiptap/pm/state'

import { nodeType } from '../schema/node-type.ts'

/**
 * What can be done to a code group in the editor (ADR-041), as ProseMirror
 * commands: one transaction each, so each is one step of undo.
 *
 * A tab is a code block inside the group, and its name lives in its own fence
 * meta (`[TypeScript]`, or `tab="TypeScript"` in a Fumadocs group), so
 * renaming a tab is rewriting that meta and nothing else. Every command puts
 * the selection into the tab it acted on, which is what lets the node view —
 * and undo, which restores the selection — show that tab.
 */

/** A tab's name, as the reader shows it: its label, its file, its language, its place. */
export function tabName(tab: PMNode, index: number): string {
  const lang = tab.attrs['language']
  const meta = tab.attrs['meta']
  return codeLabel(
    {
      type: 'code',
      lang: typeof lang === 'string' ? lang : null,
      meta: typeof meta === 'string' ? meta : null,
      value: '',
    },
    index,
  )
}

/** Whether the group is a Fumadocs one, whose every tab must carry `tab="…"` to stay in it. */
function namesByAttribute(group: PMNode): boolean {
  return group.attrs['syntax'] === 'tabs'
}

function block(schema: Schema, language: string | null, meta: string | null): PMNode {
  return nodeType(schema, 'codeBlock').create({ language, meta })
}

/**
 * A fence's meta is only written after a language (```` ```text [Name] ````),
 * so a named tab with no language is given the plain one, `text`.
 */
const PLAIN = 'text'

/** A new group of two empty tabs, in the canonical form; each is named by its language once it has one. */
export function createCodeGroupNode(schema: Schema): PMNode {
  return nodeType(schema, 'codeGroup').create(null, [
    block(schema, null, null),
    block(schema, null, null),
  ])
}

/** The group at `pos`, if that is where one is. */
function groupAt(doc: PMNode, pos: number): PMNode | undefined {
  const node = doc.nodeAt(pos)
  return node?.type.name === 'codeGroup' ? node : undefined
}

/** Where the tab at `index` of the group at `pos` starts. */
function tabStart(group: PMNode, pos: number, index: number): number {
  let start = pos + 1
  group.forEach((child, _offset, at) => {
    if (at < index) start += child.nodeSize
  })
  return start
}

/**
 * Puts the caret at the start of a tab's code, and ends the undo step there:
 * removing two tabs in quick succession is two things to take back, not one.
 */
function intoTab(tr: Transaction, start: number): Transaction {
  return closeHistory(tr.setSelection(TextSelection.create(tr.doc, start + 1)))
}

/** Adds an empty tab at the end of the group. */
export function addTab(pos: number): Command {
  return (state, dispatch) => {
    const group = groupAt(state.doc, pos)
    if (group === undefined) return false
    const tab = namesByAttribute(group)
      ? block(state.schema, PLAIN, `tab="Code ${group.childCount + 1}"`)
      : block(state.schema, null, null)
    if (dispatch !== undefined) {
      const at = pos + group.nodeSize - 1
      dispatch(intoTab(state.tr.insert(at, tab), at).scrollIntoView())
    }
    return true
  }
}

/**
 * Renames a tab, in the syntax its group names tabs in. An empty name takes
 * the label away, so the tab is named by its language again — except in a
 * Fumadocs group, where the label is what keeps the block in the group.
 */
export function renameTab(pos: number, index: number, name: string): Command {
  return (state, dispatch) => {
    const group = groupAt(state.doc, pos)
    const tab = group?.maybeChild(index)
    if (group === undefined || tab === null || tab === undefined) return false
    const current = tab.attrs['meta']
    const meta = withTabLabel(
      typeof current === 'string' ? current : null,
      name,
      namesByAttribute(group) ? 'attribute' : 'bracket',
    )
    if (meta === current || (namesByAttribute(group) && !hasTabAttribute(meta))) return false
    if (dispatch !== undefined) {
      const start = tabStart(group, pos, index)
      const language = tab.attrs['language'] ?? (meta === null ? null : PLAIN)
      dispatch(
        intoTab(state.tr.setNodeMarkup(start, undefined, { ...tab.attrs, meta, language }), start),
      )
    }
    return true
  }
}

/** Sets the language of a tab, which names it too unless it has a name of its own. */
export function setTabLanguage(pos: number, index: number, language: string | null): Command {
  return (state, dispatch) => {
    const group = groupAt(state.doc, pos)
    const tab = group?.maybeChild(index)
    if (group === undefined || tab === null || tab === undefined) return false
    if ((tab.attrs['language'] ?? null) === language) return false
    if (dispatch !== undefined) {
      const start = tabStart(group, pos, index)
      dispatch(closeHistory(state.tr.setNodeAttribute(start, 'language', language)))
    }
    return true
  }
}

/** Removes a tab; removing the last one removes the group, leaving an empty line in its place. */
export function removeTab(pos: number, index: number): Command {
  return (state, dispatch) => {
    const group = groupAt(state.doc, pos)
    const tab = group?.maybeChild(index)
    if (group === undefined || tab === null || tab === undefined) return false
    if (dispatch === undefined) return true
    if (group.childCount === 1) {
      const tr = state.tr.delete(pos, pos + group.nodeSize)
      dispatch(closeHistory(tr.setSelection(Selection.near(tr.doc.resolve(pos)))).scrollIntoView())
      return true
    }
    const start = tabStart(group, pos, index)
    const tr = state.tr.delete(start, start + tab.nodeSize)
    const neighbour = Math.min(index, group.childCount - 2)
    dispatch(intoTab(tr, tabStart(group, pos, neighbour)))
    return true
  }
}

/** Moves a tab to another place in its group. */
export function moveTab(pos: number, from: number, to: number): Command {
  return (state, dispatch) => {
    const group = groupAt(state.doc, pos)
    if (group === undefined || from === to) return false
    const tabs: PMNode[] = []
    group.forEach((child) => tabs.push(child))
    const [moving] = tabs.splice(from, 1)
    if (moving === undefined || to < 0 || to > tabs.length) return false
    tabs.splice(to, 0, moving)
    if (dispatch !== undefined) {
      const tr = state.tr.replaceWith(pos + 1, pos + group.nodeSize - 1, Fragment.from(tabs))
      const moved = group.copy(Fragment.from(tabs))
      dispatch(intoTab(tr, tabStart(moved, pos, to)))
    }
    return true
  }
}
