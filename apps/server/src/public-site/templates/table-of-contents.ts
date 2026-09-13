import type { OutlineEntry } from '@quill/application'

import { html, type Html } from '../html.ts'

/**
 * "On this page": the document's own headings (ADR-031's outline).
 *
 * The outline comes out of the render cache beside the body, and the heading
 * ids in it are the ones the renderer emitted, so every entry is a link that
 * lands somewhere — there is no second pass over the HTML looking for
 * headings, and therefore no way for the two to disagree.
 *
 * Only the top two levels are listed. A table of contents that mirrors every
 * heading is an outline of the document rather than a way to move around it,
 * and on the public site the column it sits in is 13rem wide.
 */

/** The deepest heading level the contents lists. */
export const TABLE_OF_CONTENTS_DEPTH = 3

export function renderTableOfContents(outline: readonly OutlineEntry[]): Html {
  const entries = [...flatten(outline)]
  if (entries.length === 0) return html``
  return html` <nav class="site-toc" aria-labelledby="site-toc-heading">
    <h2 class="site-toc-heading" id="site-toc-heading">On this page</h2>
    <ul>
      ${entries.map(
        (entry) => html`<li class="toc-depth-${entry.depth}">
          <a href="#${entry.id}">${entry.text}</a>
        </li>`,
      )}
    </ul>
  </nav>`
}

/**
 * The outline as a flat list, deepest level dropped.
 *
 * Lazily, because the tree is walked once and the depth cut-off is applied as
 * it goes rather than by materialising every heading and filtering afterwards
 * (AGENTS.md rule 13).
 */
function* flatten(entries: readonly OutlineEntry[]): Generator<OutlineEntry> {
  for (const entry of entries) {
    if (entry.depth > TABLE_OF_CONTENTS_DEPTH) continue
    yield entry
    yield* flatten(entry.children)
  }
}
