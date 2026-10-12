import type { Element, ElementContent, Properties } from 'hast'
import type { Schema } from 'hast-util-sanitize'
import type { Code } from 'mdast'

import type { CodeGroup } from './code-group.ts'
import { codeGroupTabs, SYNC_KEY, syncKeyOf } from './code-group.ts'
import { fenceTitle } from './fence-meta.ts'

/**
 * How code is drawn: every fenced block in a card, and a code group as its
 * cards side by side in one (ADR-041).
 *
 * The server draws what a reader without JavaScript should see — every panel
 * of a group, stacked, each captioned with its tab's name — and the reader's
 * enhancer (`@quill/design-css`, `code-blocks.ts`) turns a group into tabs and
 * gives every card its copy button. Nothing here is interactive, so a page
 * that never runs script has nothing that does not work.
 *
 * - `<div class="code-block"><pre>…</pre></div>`: a block.
 * - `<figure class="code-block"><figcaption class="code-caption"><span
 *   class="code-title">app.ts</span></figcaption><pre>…</pre></figure>`: a
 *   block with a title, the file it belongs in.
 * - `<div class="code-group" data-sync="…">` holding one titled card per tab,
 *   its caption leading with `<span class="code-label">`, the tab's name.
 */

/** What a card's caption says: its tab's name in a group, and the file its code belongs in. */
export interface CodeCaption {
  readonly label?: string | undefined
  readonly title?: string | undefined
}

function element(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

function span(className: string, value: string): Element {
  return element('span', { className: [className] }, [{ type: 'text', value }])
}

/** A block's card: a plain one, or a figure captioned by its tab's name and its file. */
export function codeCard(pre: Element, caption: CodeCaption = {}): Element {
  const parts = [
    ...(caption.label === undefined ? [] : [span('code-label', caption.label)]),
    ...(caption.title === undefined ? [] : [span('code-title', caption.title)]),
  ]
  if (parts.length === 0) return element('div', { className: ['code-block'] }, [pre])
  return element('figure', { className: ['code-block'] }, [
    element('figcaption', { className: ['code-caption'] }, parts),
    pre,
  ])
}

/** A lone block's caption: the file named by `title="…"` in its fence meta, if any. */
export function codeBlockCaption(code: Code): CodeCaption {
  return { title: fenceTitle(code.meta) }
}

/**
 * A group: its tabs' cards, in order, each captioned with its name. A group
 * with a sync key says so; any other syncs by its tabs' names across the page.
 */
export function codeGroupElement(group: CodeGroup, pre: (code: Code) => Element): Element {
  const key = syncKeyOf(group)
  return element(
    'div',
    key === undefined
      ? { className: ['code-group'] }
      : { className: ['code-group'], 'data-sync': key },
    codeGroupTabs(group).map((tab) => codeCard(pre(tab.code), tab)),
  )
}

/**
 * What the sanitiser must admit for these elements and nothing more: fixed
 * class names, and a sync key only in its own shape (ADR-011, ADR-039's
 * `SanitizeGrant`). `data-sync` is a literal, already-hyphenated property key,
 * as `data-lang` is.
 */
export const CODE_SANITIZE_GRANT: {
  readonly classes: Readonly<Record<'div' | 'figure' | 'figcaption' | 'span', readonly string[]>>
  readonly attributes: { readonly div: NonNullable<Schema['attributes']>[string] }
} = {
  classes: {
    div: ['code-block', 'code-group'],
    figure: ['code-block'],
    figcaption: ['code-caption'],
    span: ['code-label', 'code-title'],
  },
  attributes: { div: [['data-sync', SYNC_KEY]] },
}
