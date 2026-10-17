import {
  DEFAULT_LINK_DISPLAY,
  effectiveDisplay,
  internalDocumentAddress,
  linkDirective,
} from '@quill/markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import type { LinkPreviewSource } from '../blocks/link-preview-context.tsx'
import { directiveAttributes, directiveName } from '../schema/directive-attributes.ts'

/**
 * The live title of a link to another document, in the line being written
 * (ADR-042, "Internal links").
 *
 * An inline link to a document is written bare, `:link[/d/<id>]{display=inline}`,
 * so the reader draws the document's title as it is *now*, for what that reader may
 * see. In the file its words are the address, which is right for the file and wrong
 * for the author, who should see what the reader will see. So while the caret is
 * elsewhere the address is set aside and the title stands in its place; put the caret
 * in the link and the address returns, to be edited like any other text.
 *
 * Drawing only: the document holds nothing but the address, so a title that changes,
 * or that is not yet known, can never change what is saved. A link with no title yet
 * is left showing its address.
 */

interface BareDocumentLink {
  readonly from: number
  readonly to: number
  readonly address: string
}

export const liveTitleKey = new PluginKey<readonly BareDocumentLink[]>('liveLinkTitles')

/** The links being titled in this state: none where the plugin is not installed. */
export function liveTitledLinks(state: EditorState): readonly BareDocumentLink[] {
  return liveTitleKey.getState(state) ?? []
}

/**
 * The inline links between two positions that are a bare address of a document and are not
 * shown as a plain link; the whole document when no range is given.
 */
export function bareDocumentLinks(
  doc: PMNode,
  from = 0,
  to = doc.content.size,
): readonly BareDocumentLink[] {
  const found: BareDocumentLink[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'textDirective') return true
    if (directiveName(node) === 'link') {
      const link = linkDirective.parse({
        type: 'textDirective',
        name: 'link',
        attributes: directiveAttributes(node),
        children: [{ type: 'text', value: node.textContent }],
      })
      const address = internalDocumentAddress(link.url)
      // The author's own words win, as they do for the reader.
      if (
        address !== null &&
        link.text === null &&
        effectiveDisplay(link, DEFAULT_LINK_DISPLAY) !== 'url'
      ) {
        found.push({ from: pos, to: pos + node.nodeSize, address })
      }
    }
    return false
  })
  return found
}

interface Range {
  readonly from: number
  readonly to: number
}

/** Where a transaction changed the document, in the positions of the document it made. */
function changedRanges(transaction: Transaction): readonly Range[] {
  const { maps } = transaction.mapping
  return maps.flatMap((map, index) => {
    const ranges: Range[] = []
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const later = transaction.mapping.slice(index + 1)
      ranges.push({ from: later.map(newStart, -1), to: later.map(newEnd, 1) })
    })
    return ranges
  })
}

/**
 * The links after a transaction. A keystroke must not walk a document of thousands of
 * lines (AGENTS.md rule 13), so the links already known are carried through the edit and
 * only the places it touched are read again: a link the edit reached is dropped and found
 * afresh if it is still one, and one it did not reach is merely moved.
 */
function afterEdit(
  links: readonly BareDocumentLink[],
  transaction: Transaction,
): readonly BareDocumentLink[] {
  const touched = changedRanges(transaction)
  const { mapping, doc } = transaction
  const carried = links.flatMap((link) => {
    const start = mapping.mapResult(link.from, 1)
    const end = mapping.mapResult(link.to, -1)
    const moved = { ...link, from: start.pos, to: end.pos }
    const reached =
      start.deleted ||
      end.deleted ||
      touched.some((range) => moved.from < range.to && moved.to > range.from)
    return reached ? [] : [moved]
  })
  const found = touched.flatMap((range) =>
    bareDocumentLinks(doc, Math.max(0, range.from - 1), Math.min(doc.content.size, range.to + 1)),
  )
  const byPosition = new Map([...carried, ...found].map((link) => [link.from, link]))
  return [...byPosition.values()].toSorted((left, right) => left.from - right.from)
}

function titleElement(title: string): HTMLElement {
  const element = document.createElement('span')
  element.className = 'link-live-title'
  element.setAttribute('contenteditable', 'false')
  element.textContent = title
  return element
}

/** Whether the selection is within the link, so its address is shown for editing. */
function selectionInside(link: BareDocumentLink, from: number, to: number): boolean {
  return (from > link.from && from < link.to) || (to > link.from && to < link.to)
}

/**
 * @param source read at each draw, not captured: the application's lookup changes as
 * titles arrive, and the plugin is built once with the editor.
 */
export function createLiveTitles(
  source: () => LinkPreviewSource,
): Plugin<readonly BareDocumentLink[]> {
  return new Plugin<readonly BareDocumentLink[]>({
    key: liveTitleKey,
    state: {
      init: (_config, { doc }) => bareDocumentLinks(doc),
      apply: (transaction, links) =>
        transaction.docChanged ? afterEdit(links, transaction) : links,
    },
    props: {
      decorations: (state) => {
        const links = liveTitledLinks(state)
        if (links.length === 0) return null
        const { from, to } = state.selection
        const { preview } = source()
        const drawn = links.flatMap((link) => {
          const known = selectionInside(link, from, to) ? null : preview(link.address)
          if (known === null) return []
          return [
            // The address stays in the document, set aside and hidden from assistive
            // technology, which hears the title instead.
            Decoration.node(link.from, link.to, {
              class: 'link-live-source',
              'aria-hidden': 'true',
            }),
            Decoration.widget(link.from, () => titleElement(known.title), {
              side: -1,
              key: `${link.address}:${known.title}`,
            }),
          ]
        })
        return DecorationSet.create(state.doc, drawn)
      },
    },
    view: (view) => {
      // Tells the application which documents are being shown, as a card does for its address.
      const ask = () => {
        for (const link of liveTitledLinks(view.state)) source().request(link.address)
      }
      ask()
      return { update: ask }
    },
  })
}
