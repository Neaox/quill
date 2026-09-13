import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { tv } from '@quill/ui'

import type { SharedNode } from '../../lib/api/index.ts'
import { sharedDocumentLink, shareLinkTargetLink } from '../../lib/routing/document-reference.ts'

/**
 * Everything a subtree link opens, and nothing else.
 *
 * The server resolves the scope against the tree on every request and answers
 * only published documents nested under the link's target, inside its own
 * collection (`docs/architecture/api-contract-share-links.md`), so this draws
 * exactly what it is given and never filters: what is in `children` is what
 * the link opens. A document-scoped link has an empty `children`, and this
 * renders nothing at all — there is no navigation out of a link's scope.
 *
 * The application's `Tree` is deliberately not reused. It is the workspace
 * shell's signature component — collection sections, row menus, "new child
 * document" — and every one of those is a thing that must never appear on
 * this surface.
 *
 * **Nothing here preloads.** The router's `defaultPreload: 'intent'` is right
 * everywhere else, where reading a route ahead of a click costs a cached
 * request; on this surface a fetch *is* a use of the link. A preloaded child
 * route runs `GET /api/share/:token/documents/:id/rendered`, which writes a
 * `share_link.used` audit row, moves the "last opened" stamp the share dialog
 * reports, and spends the anonymous `share:read` budget — ten a minute per
 * address. A reader running their eye down a dozen titles would spend the
 * whole budget without opening anything and then be told, for a link that is
 * perfectly good, that it is not available. So both links opt out, and any
 * future preloading here has to ration itself and keep use-recording off
 * preflight requests, which is a bigger decision than a navigation component
 * should take.
 */

const styles = tv({
  slots: {
    heading: 'meta pb-2',
    list: 'flex flex-col gap-1.5 text-sm',
    nested: 'mt-1.5 flex flex-col gap-1.5 border-s border-border ps-3',
    link: [
      'block truncate text-muted transition-colors ease-standard',
      'hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2',
      'focus-visible:outline-focus-ring aria-current:font-medium aria-current:text-foreground',
    ],
  },
})()

/** The label on the navigation, and its heading. One surface, one wording. */
const LABEL = 'Shared documents'

export interface SharedNavigationProps {
  readonly token: string
  /** The link's own target, which is the first thing the list offers. */
  readonly target: { readonly id: string; readonly title: string; readonly shortId: string }
  /** What the link opens below its target; empty for a document-scoped link. */
  readonly nodes: readonly SharedNode[]
}

/**
 * The nodes as list items, recursively. A plain function rather than a
 * component: it holds no state and takes no hooks, and recursion reads as
 * recursion.
 */
function nodeItems(token: string, nodes: readonly SharedNode[]): ReactNode {
  return nodes.map((node) => (
    <li key={node.id}>
      <Link
        {...sharedDocumentLink(token, node)}
        preload={false}
        activeOptions={{ exact: true }}
        activeProps={{}}
        className={styles.link()}
      >
        {node.title}
      </Link>
      {node.children.length === 0 ? undefined : (
        <ul className={styles.nested()}>{nodeItems(token, node.children)}</ul>
      )}
    </li>
  ))
}

export function SharedNavigation({ token, target, nodes }: SharedNavigationProps) {
  if (nodes.length === 0) return undefined

  return (
    <nav aria-label={LABEL}>
      <p className={styles.heading()}>{LABEL}</p>
      <ul className={styles.list()}>
        <li>
          <Link
            {...shareLinkTargetLink(token)}
            preload={false}
            activeOptions={{ exact: true }}
            activeProps={{}}
            className={styles.link()}
          >
            {target.title}
          </Link>
          <ul className={styles.nested()}>{nodeItems(token, nodes)}</ul>
        </li>
      </ul>
    </nav>
  )
}
