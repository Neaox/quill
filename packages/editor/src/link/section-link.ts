import { createSlugger, headingId } from '@quill/markdown'
import type { EditorState } from '@tiptap/pm/state'

import type { ContextMenuEnvironment } from '../context-menu/context-menu-registry.ts'

/**
 * "Copy link to section": the address of the heading a position is under.
 *
 * A heading's anchor is derived from its words, GitHub's way, and numbered
 * when two headings say the same thing (`@quill/markdown`'s `createSlugger`);
 * the reader's renderer and table of contents derive it the same way, so the
 * link lands on the heading a reader sees (ADR-044). Only on request — a
 * click, not a keystroke — so walking the headings costs nothing while typing.
 */

export interface SectionAnchor {
  /** The heading's words. */
  readonly title: string
  /** The fragment a reader's page carries for it. */
  readonly fragment: string
}

/** The heading at or before `pos`, as an anchor; undefined above the first heading. */
export function sectionAnchor(state: EditorState, pos: number): SectionAnchor | undefined {
  const slug = createSlugger()
  let found: SectionAnchor | undefined
  state.doc.descendants((node, at) => {
    if (at > pos) return false
    if (node.type.name !== 'heading') return true
    found = { title: node.textContent, fragment: headingId(slug(node.textContent)) }
    return false
  })
  return found
}

export const NO_SECTION = 'There is no heading above this to link to'
export const NO_LINKS = 'Links to this document are not available here'

/** Why a section link cannot be copied from `pos`, or undefined when it can. */
export function sectionLinkUnavailable(
  state: EditorState,
  pos: number,
  environment: ContextMenuEnvironment,
): string | undefined {
  if (environment.linkTo === undefined || environment.copyText === undefined) return NO_LINKS
  return sectionAnchor(state, pos) === undefined ? NO_SECTION : undefined
}

/** Copies the link to the section `pos` is in; false when there is none to copy. */
export function copySectionLink(
  state: EditorState,
  pos: number,
  environment: ContextMenuEnvironment,
): boolean {
  const anchor = sectionAnchor(state, pos)
  const href = anchor === undefined ? undefined : environment.linkTo?.(anchor.fragment)
  if (href === undefined || environment.copyText === undefined) return false
  void environment.copyText(href)
  return true
}
