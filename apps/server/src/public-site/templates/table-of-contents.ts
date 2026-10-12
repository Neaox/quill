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
 * Only second- and third-level headings are listed: the first is the title,
 * which is not a section of itself, and a list that mirrors every heading is
 * an outline of the document rather than a way to move around it. And only
 * once there are enough of them: a column holding one or two links is a
 * column of nothing, so a short page gives the room back to the text.
 */

/** The deepest heading level the contents lists. */
export const TABLE_OF_CONTENTS_DEPTH = 3

/** The fewest entries worth a column of their own. */
export const TABLE_OF_CONTENTS_MINIMUM = 3

export function renderTableOfContents(outline: readonly OutlineEntry[]): Html {
  const entries = [...sections(outline)]
  if (entries.length < TABLE_OF_CONTENTS_MINIMUM) return html``
  return html`<nav class="site-toc" aria-labelledby="site-toc-heading">
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
 * The outline as a flat list of its second and third levels.
 *
 * Lazily, because the tree is walked once and the levels are chosen as it goes
 * rather than by materialising every heading and filtering afterwards
 * (AGENTS.md rule 13).
 */
function* sections(entries: readonly OutlineEntry[]): Generator<OutlineEntry> {
  for (const entry of entries) {
    if (entry.depth > TABLE_OF_CONTENTS_DEPTH) continue
    if (entry.depth >= 2) yield entry
    yield* sections(entry.children)
  }
}
