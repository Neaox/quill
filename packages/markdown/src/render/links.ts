import { toString } from 'mdast-util-to-string'
import { visit } from 'unist-util-visit'
import type { Definition, Root } from 'mdast'

import { stripPresenterNotes } from '../directives/strip-presenter-notes.ts'

export interface ExtractedLink {
  readonly kind: 'link' | 'image'
  /** Empty when a reference points at a definition the document does not have. */
  readonly url: string
  readonly title: string | undefined
  /** The link text, or an image's alternative text. */
  readonly text: string
  readonly external: boolean
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * True for anything that isn't a same-origin, relative, or id-based reference:
 * an absolute URL with a scheme (`https://…`, `mailto:…`) or a protocol-relative
 * one (`//host/…`). Shared with `handlers.ts`'s `link` handler, which uses it to
 * decide whether a rendered `<a>` needs `rel="noopener noreferrer"` (ADR-011).
 */
export function isExternal(url: string): boolean {
  return SCHEME.test(url) || url.startsWith('//')
}

function definitionsOf(ast: Root): Map<string, Definition> {
  const definitions = new Map<string, Definition>()
  visit(ast, 'definition', (node) => {
    definitions.set(node.identifier, node)
  })
  return definitions
}

/**
 * Every link and image in a document, with reference-style links resolved against
 * their definitions. This is what the link checker, the backlink index, and the
 * "what points at this document" view are built on. A link inside a presenter
 * note is the presenter's, not the document's, so it is neither a backlink nor
 * something the link checker reports to readers.
 */
export function extractLinks(ast: Root): readonly ExtractedLink[] {
  const published = stripPresenterNotes(ast)
  const definitions = definitionsOf(published)
  const links: ExtractedLink[] = []

  const resolve = (identifier: string): Definition | undefined => definitions.get(identifier)

  visit(published, (node) => {
    switch (node.type) {
      case 'link':
        links.push(link('link', node.url, node.title, toString(node)))
        break
      case 'image':
        links.push(link('image', node.url, node.title, node.alt ?? ''))
        break
      case 'linkReference': {
        const target = resolve(node.identifier)
        links.push(link('link', target?.url ?? '', target?.title, toString(node)))
        break
      }
      case 'imageReference': {
        const target = resolve(node.identifier)
        links.push(link('image', target?.url ?? '', target?.title, node.alt ?? ''))
        break
      }
      default:
        break
    }
  })

  return links
}

function link(
  kind: ExtractedLink['kind'],
  url: string,
  title: string | null | undefined,
  text: string,
): ExtractedLink {
  return { kind, url, title: title ?? undefined, text, external: isExternal(url) }
}
