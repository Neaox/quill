import { parseDocument } from '@quill/markdown'
import { Slice } from '@tiptap/pm/model'
import type { Fragment, Node as PMNode, Schema } from '@tiptap/pm/model'
import type { Command } from '@tiptap/pm/state'

import { markType, nodeType } from '../schema/node-type.ts'
import { documentFromMdast } from './ast.ts'

/**
 * The editing commands the keymap, the menus, and paste all share.
 *
 * They are ProseMirror commands rather than component callbacks, so each one is
 * exercised in a test by applying it to a state — no rendering, no keyboard, no
 * editor instance (ADR-013: business logic lives outside components).
 */

export const insertHardBreak: Command = (state, dispatch) => {
  const type = nodeType(state.schema, 'hardBreak')
  if (!state.selection.$from.parent.type.contentMatch.matchType(type)) return false
  dispatch?.(state.tr.replaceSelectionWith(type.create()).scrollIntoView())
  return true
}

/** Applies the link mark across the selection. An empty selection links nothing. */
export function setLink(href: string, title: string | null = null): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection
    if (empty) return false
    dispatch?.(state.tr.addMark(from, to, markType(state.schema, 'link').create({ href, title })))
    return true
  }
}

export const removeLink: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection
  if (empty) return false
  dispatch?.(state.tr.removeMark(from, to, markType(state.schema, 'link')))
  return true
}

export interface ImageAttributes {
  readonly src: string
  readonly alt?: string | null
  readonly title?: string | null
}

/**
 * Images are inserted by URL. Uploading one is the web application's business —
 * it holds the `AttachmentClient` — and it arrives here as a URL like any other.
 */
export function insertImage(attributes: ImageAttributes): Command {
  return (state, dispatch) => {
    const node = nodeType(state.schema, 'image').create({
      src: attributes.src,
      alt: attributes.alt ?? null,
      title: attributes.title ?? null,
    })
    dispatch?.(state.tr.replaceSelectionWith(node, false).scrollIntoView())
    return true
  }
}

/** Replaces the selection with a node, leaving the caret inside it where it can go. */
export function insertNode(node: PMNode): Command {
  return (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(node).scrollIntoView())
    return true
  }
}

/**
 * The blocks a Markdown string becomes, front matter dropped: pasting a whole
 * file into the middle of a document should bring its prose, not a second
 * metadata block, which only the first bytes of a file may be anyway.
 */
export function markdownFragment(markdown: string, schema: Schema): Fragment {
  const { ast } = parseDocument(markdown)
  const body = { ...ast, children: ast.children.filter((child) => child.type !== 'yaml') }
  // Rebuilt in the schema of the document being edited. TipTap builds its own
  // `Schema` from its extension list, so the one the converter targets and the
  // one a live editor runs are equal but not identical, and ProseMirror compares
  // node types by identity: a node from the wrong instance is silently refused.
  return schema.nodeFromJSON(documentFromMdast(body).doc.toJSON()).content
}

function isOneParagraph(fragment: Fragment): boolean {
  return fragment.childCount === 1 && fragment.child(0).type.name === 'paragraph'
}

/**
 * Pasted Markdown becomes nodes, not text (ADR-003). A single paragraph is
 * inserted as inline content so it joins the sentence the caret is in; anything
 * with structure replaces the selection as blocks.
 */
export function insertMarkdown(markdown: string): Command {
  return (state, dispatch, view) => {
    const fragment = markdownFragment(markdown, state.schema)
    if (isOneParagraph(fragment)) {
      const inline = new Slice(fragment.child(0).content, 0, 0)
      dispatch?.(state.tr.replaceSelection(inline).scrollIntoView())
      return true
    }
    // A lone block is placed rather than merged: replacing a cursor with a slice
    // of one block leaves the document untouched, because there is nothing to
    // merge it into.
    if (fragment.childCount === 1) return insertNode(fragment.child(0))(state, dispatch, view)
    dispatch?.(state.tr.replaceSelection(new Slice(fragment, 0, 0)).scrollIntoView())
    return true
  }
}
