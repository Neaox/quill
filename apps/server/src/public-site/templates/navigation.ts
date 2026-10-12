import type { PublicNavigationNode } from '@quill/application'
import type { DocumentId } from '@quill/domain'

import { html, type Html } from '../html.ts'

/**
 * The documents down the side of a public page: one disclosure per
 * collection, the one being read open (`docs/architecture/public-site.md`).
 *
 * One template for every page the site has and for the reader preview,
 * because the navigation on the home, on a document, on the search results
 * and on the not-found page has to be the same navigation — a page that built
 * its own would be the way a document carved out of the site reappears in one
 * place and not another. What differs between the two surfaces is only where
 * an entry links to, which is why a section is built with an `hrefOf`.
 *
 * It is a labelled `nav` of `details` and nested lists, so the grouping and
 * the nesting are in the markup rather than only in the indentation, a
 * collection folds with no script at all, and the page a reader is on carries
 * `aria-current="page"` rather than a colour alone (AGENTS.md rule 14).
 */

export interface NavigationEntry {
  readonly title: string
  readonly href: string
  readonly current: boolean
  readonly children: readonly NavigationEntry[]
}

export interface NavigationSection {
  /** The collection's name, which is the disclosure's summary. */
  readonly name: string
  /** Every document listed, however deeply nested: the number beside the name. */
  readonly count: number
  readonly open: boolean
  readonly entries: readonly NavigationEntry[]
}

export interface NavigationSectionInput {
  readonly name: string
  readonly nodes: readonly PublicNavigationNode[]
  readonly hrefOf: (node: PublicNavigationNode) => string
  /** The document being read, or null on the home, the search results and a miss. */
  readonly currentDocumentId: DocumentId | null
  readonly open: boolean
}

/** A collection's tree, resolved to links. */
export function navigationSection(input: NavigationSectionInput): NavigationSection {
  let count = 0
  const entriesOf = (nodes: readonly PublicNavigationNode[]): readonly NavigationEntry[] =>
    nodes.map((node) => {
      count += 1
      return {
        title: node.title,
        href: input.hrefOf(node),
        current: node.documentId === input.currentDocumentId,
        children: entriesOf(node.children),
      }
    })
  const entries = entriesOf(input.nodes)
  return { name: input.name, count, open: input.open, entries }
}

export function renderNavigation(sections: readonly NavigationSection[]): Html {
  const listed = sections.filter((section) => section.count > 0)
  if (listed.length === 0) return html``
  return html`<nav class="site-nav" aria-labelledby="site-nav-heading">
    <h2 class="visually-hidden" id="site-nav-heading">Documents</h2>
    ${listed.map(
      (section) =>
        html`<details class="site-nav-section" ${section.open ? html`open` : ''}>
          <summary>${section.name} <span class="site-nav-count">${section.count}</span></summary>
          ${renderList(section.entries)}
        </details>`,
    )}
  </nav>`
}

function renderList(entries: readonly NavigationEntry[]): Html {
  return html`<ul>
    ${entries.map(
      (entry) =>
        html`<li>
          <a href="${entry.href}" ${entry.current ? html`aria-current="page"` : ''}
            >${entry.title}</a
          >
          ${entry.children.length > 0 ? renderList(entry.children) : ''}
        </li>`,
    )}
  </ul>`
}
