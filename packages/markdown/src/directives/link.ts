import { isCardLayout, isLinkDisplay, normaliseUrl, UNCHOSEN } from '@quill/domain'
import type { LinkChoice, LinkDisplay } from '@quill/domain'
import { toString } from 'mdast-util-to-string'
import type { LeafDirective, TextDirective } from 'mdast-util-directive'

import type { Directive, DirectiveDefinition, DirectiveIssue } from './definition.ts'
import { attribute, issue, textChildren } from './definition.ts'

/**
 * `::link{url="https://…" display=card}` and `:link[https://…]{display=inline}`
 * — how a link is shown (ADR-042, "Display: the author decides").
 *
 * A link with no directive is an ordinary Markdown link and takes the
 * organisation's default. The directive exists to record a choice, and it is
 * built so the choice never costs the document its meaning:
 *
 * - **It degrades to the URL.** Outside Quill a directive reads as its text,
 *   and the text is the address (or the author's own words for it).
 * - **The author's words win.** `:link[the design doc]{url="https://…"}` keeps
 *   its text; a preview adds a favicon and a hover card but never replaces what
 *   the author wrote. Only a bare address, which is what a paste produces, is
 *   given the page's title.
 * - **What it does not understand survives.** An attribute this release does not
 *   know is kept and written back (AGENTS.md rule 7), so a document edited by a
 *   newer release is not stripped by an older one. An unknown `display` renders
 *   as a plain link, and is still written back as it was.
 *
 * Attributes: `url`; `display` (`url`, `inline`, `card`, `embed`); and, for a
 * card, `layout` (`side`, `top`), `image=none`, and `title` and `description`
 * to replace the fetched text (`description=""` hides it).
 */

export type LinkForm = 'leaf' | 'text'

export interface Link {
  /** The address as written. */
  readonly url: string
  /** The author's words for it, or null when the label is the address (or absent). */
  readonly text: string | null
  readonly choice: LinkChoice
  /** A `display` this release does not know, kept verbatim and drawn as a plain link. */
  readonly unrecognisedDisplay: string | null
  /** Attributes this release does not know, in the order written. */
  readonly extra: Readonly<Record<string, string>>
  readonly form: LinkForm
}

const KNOWN = new Set(['url', 'display', 'layout', 'image', 'title', 'description'])

/** The display a link is drawn with when nothing else decides: unrecognised is plain. */
export function effectiveDisplay(link: Link, fallback: LinkDisplay): LinkDisplay {
  if (link.unrecognisedDisplay !== null) return 'url'
  return link.choice.display ?? fallback
}

function stringAttributes(node: Directive): Readonly<Record<string, string>> {
  // A valueless attribute (`{image}`) reads as the empty string it stands for.
  return Object.fromEntries(
    Object.entries(node.attributes ?? {}).map(([name, value]) => [name, value ?? '']),
  )
}

function parseLink(node: LeafDirective | TextDirective): Link {
  const attributes = stringAttributes(node)
  const label = toString(node).trim()
  const url = (attributes['url'] ?? label).trim()
  const display = attributes['display']
  const layout = attributes['layout']
  const image = attributes['image']
  const title = attributes['title']
  const description = attributes['description']

  const known = isLinkDisplay(display)
  return {
    url,
    // The label is the author's words unless it is simply the address again.
    text: label === '' || label === url ? null : label,
    choice: {
      display: known ? display : null,
      layout: isCardLayout(layout) ? layout : UNCHOSEN.layout,
      showImage: image !== 'none',
      title: title === undefined || title === '' ? null : title,
      description: description ?? null,
    },
    unrecognisedDisplay: display === undefined || known ? null : display,
    extra: Object.fromEntries(
      Object.entries(attributes).filter(
        ([name, value]) =>
          !KNOWN.has(name) ||
          // A layout or image value we did not understand is kept, not dropped.
          (name === 'layout' && !isCardLayout(value)) ||
          (name === 'image' && value !== 'none'),
      ),
    ),
    form: node.type === 'leafDirective' ? 'leaf' : 'text',
  }
}

/** Written in a fixed order, so a document that is saved twice does not change. */
function writeAttributes(model: Link): Record<string, string> {
  const { choice } = model
  const written: Record<string, string> = {}
  const spellsUrl = model.form === 'text' && model.text === null
  if (!spellsUrl) written['url'] = model.url
  if (model.unrecognisedDisplay !== null) written['display'] = model.unrecognisedDisplay
  else if (choice.display !== null) written['display'] = choice.display
  if (choice.layout !== UNCHOSEN.layout) written['layout'] = choice.layout
  if (!choice.showImage) written['image'] = 'none'
  if (choice.title !== null) written['title'] = choice.title
  if (choice.description !== null) written['description'] = choice.description
  return { ...written, ...model.extra }
}

export const linkDirective: DirectiveDefinition<Link, LeafDirective | TextDirective> = {
  names: ['link'],
  kinds: ['leaf', 'text'],

  parse: parseLink,

  validate(node: Directive): readonly DirectiveIssue[] {
    if (node.type === 'containerDirective') return []
    const model = parseLink(node)
    const found: DirectiveIssue[] = []
    if (normaliseUrl(model.url) === null) {
      found.push(
        issue(
          'url',
          'A link needs an http or https address; shown as the text it was written with.',
          'warning',
        ),
      )
    }
    if (model.unrecognisedDisplay !== null) {
      found.push(
        issue(
          'display',
          `Unknown display "${model.unrecognisedDisplay}"; shown as a plain link.`,
          'warning',
        ),
      )
    }
    const layout = attribute(node, 'layout')
    if (layout !== undefined && !isCardLayout(layout)) {
      found.push(
        issue('layout', `Unknown card layout "${layout}"; shown beside the text.`, 'warning'),
      )
    }
    return found
  },

  serialize(model: Link): LeafDirective | TextDirective {
    if (model.form === 'leaf') {
      return {
        type: 'leafDirective',
        name: 'link',
        attributes: writeAttributes(model),
        children: model.text === null ? [] : textChildren(model.text),
      }
    }
    return {
      type: 'textDirective',
      name: 'link',
      attributes: writeAttributes(model),
      children: textChildren(model.text ?? model.url),
    }
  },
}
