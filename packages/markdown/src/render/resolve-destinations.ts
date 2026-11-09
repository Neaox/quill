import type {
  Definition,
  Image,
  ImageReference,
  Link,
  LinkReference,
  PhrasingContent,
  Root,
} from 'mdast'
import { SKIP, visit } from 'unist-util-visit'

/**
 * What a destination as written resolved to before the render: another
 * address, or nothing, so the link is shown as its words and an image as its
 * alternative text.
 */
export type DestinationResolution =
  | { readonly kind: 'href'; readonly href: string }
  | { readonly kind: 'text' }

/** Resolutions by the destination exactly as the tree holds it (`node.url`). */
export interface ResolvedDestinations {
  readonly links?: ReadonlyMap<string, DestinationResolution> | undefined
  readonly images?: ReadonlyMap<string, DestinationResolution> | undefined
}

/**
 * Gives a document's links and images the addresses their destinations
 * resolved to, before it is rendered (ADR-061, "Relative links, resolved at
 * render").
 *
 * A file read from a repository links to its neighbours as the repository
 * does (`../adr/0012-auth.md#token-rotation`). Those destinations are
 * resolved by the caller, against the revision being rendered, and handed in
 * as part of the render input, so the body stays a pure function of that
 * input (ADR-031). The stored text is never rewritten: a destination is
 * replaced only in the tree a render is drawn from, and the links extracted
 * from that tree are the resolved ones the link index records.
 *
 * A destination resolved to text loses its element and keeps its words; a
 * reference-style link whose definition resolved to text does too. A
 * destination with no resolution is left exactly as written.
 *
 * The tree is changed in place: it is the one a render has just parsed and
 * owns.
 */
export function resolveDestinations(ast: Root, resolved: ResolvedDestinations): Root {
  const links = resolved.links ?? new Map<string, DestinationResolution>()
  const images = resolved.images ?? new Map<string, DestinationResolution>()
  if (links.size === 0 && images.size === 0) return ast

  // A definition serves links and images alike, so each use is resolved by
  // the map of its own kind and drawn inline with what it resolved to; the
  // definition itself, which draws nothing, is left as written.
  const definitions = new Map<string, Definition>()
  visit(ast, 'definition', (node) => {
    definitions.set(node.identifier, node)
  })

  const replacementFor = (node: Destined): readonly PhrasingContent[] | undefined => {
    switch (node.type) {
      case 'link': {
        const resolution = links.get(node.url)
        if (resolution?.kind === 'text') return node.children
        if (resolution?.kind === 'href') node.url = resolution.href
        return undefined
      }
      case 'image': {
        const resolution = images.get(node.url)
        if (resolution?.kind === 'text') return altText(node.alt)
        if (resolution?.kind === 'href') node.url = resolution.href
        return undefined
      }
      case 'linkReference': {
        const definition = definitions.get(node.identifier)
        if (definition === undefined) return undefined
        const resolution = links.get(definition.url)
        if (resolution === undefined) return undefined
        if (resolution.kind === 'text') return node.children
        return [
          { type: 'link', url: resolution.href, title: definition.title, children: node.children },
        ]
      }
      case 'imageReference': {
        const definition = definitions.get(node.identifier)
        if (definition === undefined) return undefined
        const resolution = images.get(definition.url)
        if (resolution === undefined) return undefined
        if (resolution.kind === 'text') return altText(node.alt)
        return [{ type: 'image', url: resolution.href, title: definition.title, alt: node.alt }]
      }
    }
  }

  visit(ast, DESTINED, (node: Destined, index, parent) => {
    const replacement = replacementFor(node)
    if (replacement === undefined) return undefined
    /* v8 ignore next -- a link or an image always has a parent and an index. */
    if (parent === undefined || index === undefined) return undefined
    parent.children.splice(index, 1, ...replacement)
    // The replacement now stands where the node stood: visit it from there.
    return [SKIP, index]
  })
  return ast
}

/** What carries a destination. */
type Destined = Link | Image | LinkReference | ImageReference
const DESTINED = ['link', 'image', 'linkReference', 'imageReference'] as const

function altText(alt: string | null | undefined): readonly PhrasingContent[] {
  return alt === null || alt === undefined || alt === '' ? [] : [{ type: 'text', value: alt }]
}
