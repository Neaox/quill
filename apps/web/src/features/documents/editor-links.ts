import { documentIdOf } from '@quill/editor'

/**
 * Where the editor's links go when an author opens one or copies a link to
 * a section (the link card, the link popover, the context menu).
 *
 * A link to another Quill document is written by its id (`/d/<id>`, AGENTS.md
 * rule 8); opened from the editor it is that document's reading page. Every
 * link opens in a new tab, so the draft being written stays where it is.
 */

/** The address an editor link opens at. */
export function editorLinkAddress(href: string, workspaceSlug: string, origin: string): string {
  const id = documentIdOf(href)
  if (id === undefined) return href
  const fragment = href.includes('#') ? href.slice(href.indexOf('#')) : ''
  return `${origin}/w/${workspaceSlug}/d/${id}${fragment}`
}

/** This document's reading page at a fragment, for "Copy link to section". */
export function sectionAddress(
  workspaceSlug: string,
  documentId: string,
  fragment: string,
  origin: string,
): string {
  return `${origin}/w/${workspaceSlug}/d/${documentId}#${fragment}`
}

/** Opens an editor link in a new tab, with no handle back on this one (ADR-011). */
export function openEditorLink(href: string, workspaceSlug: string): void {
  globalThis.open(
    editorLinkAddress(href, workspaceSlug, globalThis.location.origin),
    '_blank',
    'noopener,noreferrer',
  )
}
