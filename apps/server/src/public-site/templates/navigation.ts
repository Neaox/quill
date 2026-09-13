import type { PublicNavigationNode } from '@quill/application'
import { publicPageHref } from '@quill/application'

import { html, type Html } from '../html.ts'

/**
 * The published collection's tree, as the site's section navigation
 * (`docs/design/canvas/Presenting.dc.html`).
 *
 * One template, used by every public page, because the navigation on the home,
 * on a document, on the search results and on the not-found page has to be the
 * same navigation — a page that built its own would be the way a document
 * carved out of the site reappears in one place and not another.
 *
 * It is a `nav` with a label and nested lists, so the nesting is in the markup
 * rather than only in the indentation, and the page a reader is on carries
 * `aria-current="page"` rather than a colour alone (AGENTS.md rule 14).
 */

export interface NavigationView {
  readonly siteSlug: string
  readonly nodes: readonly PublicNavigationNode[]
  /** The path of the page being rendered, or null on the home and on search. */
  readonly currentPath: string | null
}

export function renderNavigation(view: NavigationView): Html {
  if (view.nodes.length === 0) return html``
  return html` <nav class="site-nav" aria-labelledby="site-nav-heading">
    <h2 class="site-nav-heading" id="site-nav-heading">On this site</h2>
    ${renderList(view, view.nodes)}
  </nav>`
}

function renderList(view: NavigationView, nodes: readonly PublicNavigationNode[]): Html {
  return html`<ul>
    ${nodes.map((node) => renderNode(view, node))}
  </ul>`
}

function renderNode(view: NavigationView, node: PublicNavigationNode): Html {
  const current = node.path === view.currentPath
  return html`<li>
    <a
      href="${publicPageHref(view.siteSlug, node.path)}"
      ${current ? html`aria-current="page"` : ''}
      >${node.title}</a
    >
    ${node.children.length > 0 ? renderList(view, node.children) : ''}
  </li>`
}
