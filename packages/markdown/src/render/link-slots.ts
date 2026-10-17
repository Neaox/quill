import { isBlockDisplay, isLinkDisplay, nearestEmbedRatio, normaliseUrl } from '@quill/domain'
import type {
  EmbedRegistry,
  LinkChoice,
  LinkDisplay,
  LinkPreview,
  LinkPreviewView,
  PreviewImage,
} from '@quill/domain'
import { fromHtml } from 'hast-util-from-html'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'
import type { Element, ElementContent, RootContent } from 'hast'

import type { Link } from '../directives/link.ts'

/**
 * A link with a stored choice, in the body and then on the page (ADR-042,
 * ADR-031).
 *
 * **In the body** a `link` directive renders as a *slot*: an ordinary anchor
 * carrying what the author chose and the normalised address a preview is stored
 * under. The body stays a pure function of the source, as ADR-031 requires, and
 * the slot is already a perfectly good link: it is what a reader sees before a
 * preview exists, what a crawler and a printout see, and what an export keeps.
 *
 * **On the page** `fillLinkSlots` swaps each slot for a chip or a card when a
 * preview is ready. It never fetches and knows nothing of storage: it is handed
 * the previews, looked up in one batch by the caller, and it leaves a slot it has
 * nothing for exactly as it was. That asymmetry is the export rule: an export
 * is a body that was never filled, so every link in it is plain.
 */

const SLOT = 'data-link-slot'
const BLOCK_CLASS = 'link-slot-block'

type Properties = Element['properties']

function element(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

const text = (value: string): ElementContent => ({ type: 'text', value })

// ---------------------------------------------------------------------------
// Emission: the body's slot
// ---------------------------------------------------------------------------

/** What the author chose, as the attributes a slot carries. Absent means "not chosen". */
function choiceProperties(link: Link): Properties {
  const { choice } = link
  const display = link.unrecognisedDisplay === null ? choice.display : 'url'
  return {
    ...(display === null ? {} : { 'data-display': display }),
    ...(choice.layout === 'side' ? {} : { 'data-layout': choice.layout }),
    ...(choice.showImage ? {} : { 'data-image': 'none' }),
    ...(choice.title === null ? {} : { 'data-title': choice.title }),
    ...(choice.description === null ? {} : { 'data-description': choice.description }),
    ...(link.text === null ? {} : { 'data-link-words': '' }),
  }
}

/**
 * The body's rendering of a `link` directive: an anchor in a paragraph of its
 * own for the block form, the anchor alone for the inline form. An address that
 * cannot be previewed is drawn as the text it was written with, since a
 * directive must never make words disappear.
 */
export function linkSlot(link: Link): ElementContent {
  const words = link.text ?? link.url
  const key = normaliseUrl(link.url)
  if (key === null) return link.form === 'leaf' ? element('p', {}, [text(words)]) : text(words)

  const anchor = element(
    'a',
    { href: new URL(link.url).href, [SLOT]: '', 'data-link-key': key, ...choiceProperties(link) },
    [text(words)],
  )
  return link.form === 'leaf' ? element('p', { className: [BLOCK_CLASS] }, [anchor]) : anchor
}

// ---------------------------------------------------------------------------
// Filling: the page's previews
// ---------------------------------------------------------------------------

export interface FillOptions {
  /** What a link with no `display` of its own is drawn as: the organisation's default. */
  readonly defaultDisplay: LinkDisplay
  /** Where a stored picture is served from. */
  readonly imageUrl: (image: PreviewImage) => string
  /**
   * The embed allowlist as this instance runs it (ADR-042). Without it, or for an embed it
   * does not recognise, an `embed` is drawn as the card it falls back to: a frame is drawn
   * only when the allowlist vouches for it, here, at the moment of drawing.
   */
  readonly embeds?: EmbedRegistry
}

/**
 * A parsed tree names `data-link-key` as the property `dataLinkKey`, where the
 * tree this module builds uses the attribute's own name; reading goes through
 * the parsed form because the page's body always arrives as HTML.
 */
function dataProperty(attribute: string): string {
  return attribute.replace(/-([a-z])/gu, (_match, letter: string) => letter.toUpperCase())
}

function isSlot(node: ElementContent | RootContent): node is Element {
  return (
    node.type === 'element' &&
    node.tagName === 'a' &&
    node.properties[dataProperty(SLOT)] !== undefined
  )
}

function property(node: Element, attribute: string): string | undefined {
  const value = node.properties[dataProperty(attribute)]
  return typeof value === 'string' ? value : undefined
}

/** The choice a slot carries, read back from its attributes. */
function choiceOf(slot: Element): LinkChoice {
  const display = property(slot, 'data-display')
  const layout = property(slot, 'data-layout')
  return {
    display: isLinkDisplay(display) ? display : null,
    layout: layout === 'top' ? 'top' : 'side',
    showImage: property(slot, 'data-image') !== 'none',
    title: property(slot, 'data-title') ?? null,
    description: property(slot, 'data-description') ?? null,
  }
}

function icon(
  image: PreviewImage | null,
  options: FillOptions,
  className: string,
): ElementContent[] {
  if (image === null) return []
  return [
    element(
      'img',
      {
        className: [className],
        src: options.imageUrl(image),
        alt: '',
        width: image.width,
        height: image.height,
        loading: 'lazy',
        decoding: 'async',
      },
      [],
    ),
  ]
}

const EXTERNAL_REL = ['noopener', 'noreferrer']

/**
 * The inline form: the favicon and a title. An author's own words stay, since a
 * link someone wrote words for is not a bare address to be improved on.
 */
function chip(
  slot: Element,
  preview: LinkPreview,
  choice: LinkChoice,
  options: FillOptions,
): Element {
  const authored = slot.properties[dataProperty('data-link-words')] !== undefined
  const label = authored ? slot.children : [text(choice.title ?? preview.title)]
  return element(
    'a',
    {
      className: ['link-chip'],
      href: slot.properties['href'],
      rel: EXTERNAL_REL,
      title: preview.description ?? undefined,
    },
    [
      ...icon(preview.favicon, options, 'link-chip-icon'),
      element('span', { className: ['link-chip-text'] }, [...label]),
      ...status(preview),
    ],
  )
}

/**
 * The state a connector reported (an open pull request, a merged one), as a small
 * lozenge. Its words say what it is; the tone only colours it, so nothing is carried
 * by colour alone.
 */
function status(preview: LinkPreview): ElementContent[] {
  if (preview.status === undefined) return []
  return [
    element('span', { className: ['link-status'], 'data-tone': preview.status.tone }, [
      text(preview.status.label),
    ]),
  ]
}

/**
 * One line: icon, title and site, as a block of its own. For a list of
 * references, where a card per link would be a wall.
 */
function compact(
  slot: Element,
  preview: LinkPreview,
  choice: LinkChoice,
  options: FillOptions,
): Element {
  return element(
    'a',
    { className: ['link-compact'], href: slot.properties['href'], rel: EXTERNAL_REL },
    [
      ...icon(preview.favicon, options, 'link-chip-icon'),
      element('span', { className: ['link-compact-title'] }, [text(choice.title ?? preview.title)]),
      ...status(preview),
      element('span', { className: ['link-compact-site'] }, [text(preview.siteName ?? '')]),
    ],
  )
}

/** A language name is a class suffix, so only a plain one is used; anything else could add classes. */
const PLAIN_LANGUAGE = /^[a-z][a-z0-9+#-]{0,31}$/u

/**
 * A permalink to lines of source, from a connector (ADR-042): a figure whose caption is the
 * one link, and whose body is the code as text.
 *
 * Only the caption is a link, so the code can be selected and copied, which a card-wide
 * anchor would make awkward. Every line is a text node, escaped by the serialiser and
 * never interpreted; nothing is highlighted, because highlighting means running a
 * script or trusting markup from a stranger's file. Line numbers are CSS (`data-line`),
 * so they are not copied with the code. The block scrolls sideways for a long line,
 * which makes it a keyboard stop; the figure is named by its caption.
 */
function codeCard(slot: Element, preview: LinkPreview, choice: LinkChoice): Element | null {
  const { code } = preview
  if (code === undefined) return null
  const title = choice.title ?? preview.title
  const language =
    code.language !== null && PLAIN_LANGUAGE.test(code.language) ? code.language : null
  return element(
    'figure',
    { className: ['link-code'], ...(language === null ? {} : { 'data-language': language }) },
    [
      element('figcaption', { className: ['link-code-caption'] }, [
        element(
          'a',
          { className: ['link-code-title'], href: slot.properties['href'], rel: EXTERNAL_REL },
          [text(title)],
        ),
        element('span', { className: ['link-code-repository'] }, [text(code.repository)]),
        ...status(preview),
      ]),
      element('pre', { className: ['link-code-lines'], tabIndex: 0 }, [
        element(
          'code',
          language === null ? {} : { className: [`language-${language}`] },
          code.lines.map((line, index) =>
            element(
              'span',
              { className: ['link-code-line'], 'data-line': String(code.startLine + index) },
              [
                text(`${line}
`),
              ],
            ),
          ),
        ),
      ]),
    ],
  )
}

/**
 * The block form: one anchor, so one tab stop and one name for a screen reader.
 * The picture is decoration and carries the dimensions it was stored with, so
 * the page does not shift as it loads.
 */
function card(
  slot: Element,
  preview: LinkPreview,
  choice: LinkChoice,
  options: FillOptions,
): Element {
  const snippet = codeCard(slot, preview, choice)
  if (snippet !== null) return snippet
  const description = choice.description ?? preview.description
  const showImage = choice.showImage && preview.thumbnail !== null
  return element(
    'a',
    {
      className: ['link-card'],
      href: slot.properties['href'],
      rel: EXTERNAL_REL,
      'data-layout': choice.layout,
      ...(showImage ? { 'data-image': 'yes' } : {}),
    },
    [
      element('span', { className: ['link-card-body'] }, [
        element('strong', { className: ['link-card-title'] }, [
          text(choice.title ?? preview.title),
        ]),
        ...(description === null || description === ''
          ? []
          : [element('span', { className: ['link-card-description'] }, [text(description)])]),
        element('span', { className: ['link-card-site'] }, [
          ...icon(preview.favicon, options, 'link-chip-icon'),
          text(preview.siteName ?? ''),
          ...status(preview),
        ]),
      ]),
      ...(showImage ? icon(preview.thumbnail, options, 'link-card-image') : []),
    ],
  )
}

/**
 * A live embed: one lazy, sandboxed frame from the allowlist, held in a box of its shape.
 *
 * Everything about the frame comes from the allowlist's entry for its provider, not from
 * the stored preview: the `sandbox` and `allow` tokens, the name, and whether the address is
 * one the provider may frame. The preview's `src` is *checked* (`recognise`) and drawn only if
 * it passes, so a stored preview that was edited, or made for a provider since switched off,
 * degrades to a card. The caption link is the fallback: it is a real link to the page, for a
 * reader whose browser or network will not load the frame (an `<iframe>`'s own content is not
 * parsed as markup, so a link inside it would never be seen).
 */
function embed(
  slot: Element,
  preview: LinkPreview,
  choice: LinkChoice,
  options: FillOptions,
): Element {
  const provider =
    preview.embed === undefined ? null : (options.embeds?.recognise(preview.embed) ?? null)
  if (preview.embed === undefined || provider === null) return card(slot, preview, choice, options)

  const title = choice.title ?? preview.title
  return element(
    'figure',
    {
      className: ['link-embed'],
      'data-provider': provider.id,
      'data-ratio': nearestEmbedRatio(preview.embed.aspectRatio).replace(':', '-'),
    },
    [
      element('div', { className: ['link-embed-frame'] }, [
        element(
          'iframe',
          {
            src: preview.embed.src,
            title: `${title} (${provider.name})`,
            loading: 'lazy',
            sandbox: [...provider.sandbox],
            allow: provider.allow.join('; '),
            referrerPolicy: 'strict-origin-when-cross-origin',
          },
          [],
        ),
      ]),
      element('figcaption', { className: ['link-embed-caption'] }, [
        element('a', { href: slot.properties['href'], rel: EXTERNAL_REL }, [text(title)]),
        element('span', { className: ['link-embed-provider'] }, [text(provider.name)]),
      ]),
    ],
  )
}

type Drawer = (
  slot: Element,
  preview: LinkPreview,
  choice: LinkChoice,
  options: FillOptions,
) => Element

/**
 * How each display is drawn **as a block**, by name. A display added later (an embed's
 * frame, a file's card) is one entry here and one function above, and nothing in the
 * slot-finding or the fill has to know. A display with no entry, or `url`, is the plain link.
 */
const BLOCK_DRAWERS: Readonly<Partial<Record<LinkDisplay, Drawer>>> = {
  compact,
  card,
  embed,
}

/** The replacement for a slot, or null to leave it as the plain link it is. */
function replacement(
  slot: Element,
  isBlock: boolean,
  view: LinkPreviewView | undefined,
  options: FillOptions,
): Element | null {
  if (view?.state !== 'ready') return null
  const choice = choiceOf(slot)
  const display = choice.display ?? options.defaultDisplay
  if (display === 'url') return null
  // A block display is a block: inline in a sentence it would break the line it sits in,
  // so there it is a chip.
  const drawBlock = isBlock && isBlockDisplay(display) ? BLOCK_DRAWERS[display] : undefined
  return (drawBlock ?? chip)(slot, view.preview, choice, options)
}

const stringify = unified().use(rehypeStringify, { allowDangerousHtml: false }).freeze()

// ---------------------------------------------------------------------------
// Finding the slots in a rendered body, without parsing the body
// ---------------------------------------------------------------------------

/**
 * What a slot looks like in the rendered body, byte for byte, because this
 * module wrote it: an anchor whose first attribute is the address and whose
 * second is the slot marker, in a paragraph of a known class for the block form.
 *
 * The body is large and a page needs only these few anchors, so they are found
 * by searching for the marker and cut out as small fragments, instead of parsing
 * the whole document into a tree and writing it out again, which on a 225 KB
 * body with 50 links cost about 100 ms each time.
 *
 * Finding them this way is only sound because of what the body is. The tag
 * `<a href="` followed by a closing quote and then the marker cannot be produced
 * by anything an author writes: raw HTML in Markdown is turned into text, text
 * has its `<` escaped, and an attribute value has its `"` escaped, so no run of
 * characters inside either can contain a raw `"` after an `<a href="`.
 */
const MARKER = 'data-link-slot'
const ANCHOR_OPEN = '<a href="'
const SLOT_AFTER_HREF = '" data-link-slot=""'
const BLOCK_OPEN = '<p class="link-slot-block">'
const BLOCK_CLOSE = '</p>'
const ANCHOR_CLOSE = '</a>'

interface FoundSlot {
  /** Where the slot, with its paragraph for the block form, begins and ends in the body. */
  readonly start: number
  readonly end: number
  readonly slot: Element
  readonly block: boolean
}

/** The one anchor in a fragment, if it is a slot; else null, and the text is left alone. */
function parseSlot(fragment: string): Element | null {
  // The fragment was cut to begin with the slot's own opening tag, so it always parses to
  // one; the check is for the type, and for a body that was not made by `linkSlot`.
  /* v8 ignore next */
  return fromHtml(fragment, { fragment: true }).children.find(isSlot) ?? null
}

function findSlots(html: string): readonly FoundSlot[] {
  const found: FoundSlot[] = []
  let from = 0
  for (let at = html.indexOf(MARKER, from); at !== -1; at = html.indexOf(MARKER, from)) {
    from = at + MARKER.length
    const start = html.lastIndexOf(ANCHOR_OPEN, at)
    const hrefEnd = start === -1 ? -1 : html.indexOf('"', start + ANCHOR_OPEN.length)
    const anchorEnd = html.indexOf(ANCHOR_CLOSE, at)
    if (start < 0 || hrefEnd < 0 || !html.startsWith(SLOT_AFTER_HREF, hrefEnd) || anchorEnd < 0) {
      continue
    }
    const end = anchorEnd + ANCHOR_CLOSE.length
    const slot = parseSlot(html.slice(start, end))
    /* v8 ignore next */
    if (slot === null) continue

    const blockStart = start - BLOCK_OPEN.length
    const block =
      blockStart >= (found.at(-1)?.end ?? 0) &&
      html.startsWith(BLOCK_OPEN, blockStart) &&
      html.startsWith(BLOCK_CLOSE, end)
    found.push({
      start: block ? blockStart : start,
      end: block ? end + BLOCK_CLOSE.length : end,
      slot,
      block,
    })
    from = end
  }
  return found
}

function slotKey(slot: Element): string | undefined {
  return property(slot, 'data-link-key')
}

function render(drawn: Element): string {
  return String(stringify.stringify({ type: 'root', children: [drawn] }))
}

export interface LinkSlots {
  /** The addresses the body's slots will look up, in order of appearance, each once. */
  readonly keys: readonly string[]
  /** The body with each slot that has a ready preview drawn with it; the rest as they were. */
  draw(previews: ReadonlyMap<string, LinkPreviewView>, options: FillOptions): string
}

/**
 * Finds the slots in a rendered body once, for the caller to ask what they will
 * need (`keys`) and then to fill them (`fill`) without searching again. A body
 * with no slots costs one search for a marker and comes back untouched.
 */
export function scanLinkSlots(html: string): LinkSlots {
  const slots = findSlots(html)
  const keys = [...new Set(slots.flatMap(({ slot }) => slotKey(slot) ?? []))]

  return {
    keys,
    draw(previews, options) {
      let result = ''
      let copied = 0
      for (const { start, end, slot, block } of slots) {
        const key = slotKey(slot)
        const filled = replacement(
          slot,
          block,
          key === undefined ? undefined : previews.get(key),
          options,
        )
        // Nothing to draw: the slot is already the plain link.
        if (filled === null) continue
        result += html.slice(copied, start) + render(filled)
        copied = end
      }
      return copied === 0 ? html : result + html.slice(copied)
    },
  }
}

/** The addresses a body's slots will look up; see `scanLinkSlots` to also fill them. */
export function linkSlotKeys(html: string): readonly string[] {
  return scanLinkSlots(html).keys
}

/** The body with its slots filled; see `scanLinkSlots` to also ask for the keys. */
export function fillLinkSlots(
  html: string,
  previews: ReadonlyMap<string, LinkPreviewView>,
  options: FillOptions,
): string {
  return scanLinkSlots(html).draw(previews, options)
}
