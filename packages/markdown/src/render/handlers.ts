import { toString } from 'mdast-util-to-string'
import type { Element, ElementContent, Properties } from 'hast'
import type { Blockquote, Code, Heading, Image, Paragraph, PhrasingContent, Table } from 'mdast'
import type { ContainerDirective, LeafDirective, TextDirective } from 'mdast-util-directive'

import type { CodeGroup } from '../code-group/code-group.ts'
import { codeBlockCaption, codeCard, codeGroupElement } from '../code-group/render.ts'
import type { Details } from '../details/details.ts'
import { isAccordion, isDetailsNode } from '../details/details.ts'
import { createDetailsRenderer } from '../details/render.ts'
import { badgeDirective } from '../directives/badge.ts'
import { linkDirective } from '../directives/link.ts'
import type { CalloutType } from '../directives/callout.ts'
import { calloutDirective } from '../directives/callout.ts'
import { cardsDirective } from '../directives/cards.ts'
import { childrenDirective } from '../directives/children.ts'
import type { DirectiveAttributes, DirectiveContent } from '../directives/definition.ts'
import { claims } from '../directives/definition.ts'
import { figureDirective } from '../directives/figure.ts'
import { guidanceDirective } from '../directives/guidance.ts'
import { kbdDirective } from '../directives/kbd.ts'
import { isLabel } from '../directives/label.ts'
import { layoutDirective } from '../directives/layout.ts'
import { optionalDirective } from '../directives/optional.ts'
import { placeholderDirective } from '../directives/placeholder.ts'
import { repeatDirective } from '../directives/repeat.ts'
import { tocDirective } from '../directives/toc.ts'
import type { OutlineEntry } from './outline.ts'
import { outlineWithin } from './outline.ts'
import { smallDirective } from '../directives/small.ts'
import type { TableOptions } from '../directives/table.ts'
import { DEFAULT_TABLE_OPTIONS, tableDirective, tableOf } from '../directives/table.ts'
import type { ResolvedEmoji } from '../emoji/emoji.ts'
import { emojiElement } from '../emoji/emoji.ts'
import type { MarkdownRegistry } from '../extensions/registry.ts'
import { splitAlert } from '../pipeline/github-alert.ts'
import { drawingElement } from './drawing-element.ts'
import { linkSlot } from './link-slots.ts'
import type { Slugger } from './slug.ts'
import { HEADING_ID_PREFIX, headingId } from './slug.ts'
import type { Handlers, State } from './hast-state.ts'
import { createTableRenderer } from './table-block.ts'
import { listItem } from './task-list.ts'

/** The handler map and its state, defined beside the other parts that render (`hast-state.ts`). */
export type { Handlers, State } from './hast-state.ts'

/**
 * A highlighted block: the packed token ranges, and the language the tokenizer
 * actually resolved the fence tag to.
 *
 * The renderer has no grammars and so cannot resolve a fence tag itself
 * (ADR-030); saying which language was used is the tokenizer's to report, and
 * `data-lang` is only truthful when it comes from there.
 */
export interface HighlightedCode {
  readonly language: string
  readonly tokens: string
}

/**
 * Returns a code block's highlighting, or null to leave it unhighlighted.
 *
 * Returning a bare string of packed ranges is still accepted and means "I have
 * no resolved language to report", in which case `data-lang` falls back to the
 * fence tag as written, validated and bounded.
 */
export type Highlighter = (text: string, language: string) => string | HighlightedCode | null

/**
 * A fence tag this renderer is willing to put in `data-lang`: a short, plain
 * language name of the shape every grammar key and file extension has.
 *
 * `node.lang` is whatever the author typed after the backticks, unbounded and
 * arbitrary. It reaches an HTML attribute, and it sits next to a `data-tokens`
 * computed from the *resolved* language, so an unvalidated tag could both bloat
 * the page and claim a language the ranges were never produced for.
 */
const FENCE_LANGUAGE = /^[A-Za-z0-9][\w+#.-]{0,31}$/

/**
 * Fence tags whose source is a diagram to be drawn, not code to be read. The
 * server cannot draw one (Mermaid lays text out in a browser), so the block
 * keeps its source and gains a slot the reader draws into; without JavaScript
 * the reader still sees the source, which is what Mermaid is written to be
 * readable as.
 */
export const DIAGRAM_LANGUAGES: ReadonlySet<string> = new Set(['mermaid'])

/** Whether inline content is drawn as a pill: a badge, or one of the organisation's labels. */
function isPill(child: PhrasingContent | undefined, labels: ReadonlySet<string>): boolean {
  return (
    child?.type === 'textDirective' && (claims(badgeDirective, child) || isLabel(child, labels))
  )
}

/**
 * Whether a table cell's inline content belongs to the status line that opens
 * it: badges and labels, the short code terms that qualify them (`in`,
 * `out`), and the spaces between.
 */
function isStatusPart(child: PhrasingContent, labels: ReadonlySet<string>): boolean {
  if (child.type === 'textDirective') return isPill(child, labels)
  if (child.type === 'inlineCode') return true
  return child.type === 'text' && child.value.trim().length === 0
}

/** A cell's opening status line and the detail after it; no status unless a pill leads. */
function splitStatus(
  children: readonly PhrasingContent[],
  labels: ReadonlySet<string>,
): {
  readonly status: PhrasingContent[]
  readonly detail: PhrasingContent[]
} {
  const end = isPill(children[0], labels)
    ? children.findIndex((child) => !isStatusPart(child, labels))
    : 0
  const split = end === -1 ? children.length : end
  const status = children.slice(0, split)
  const lastSpoken = status.findLastIndex((child) => child.type !== 'text')
  const [opening, ...rest] = children.slice(split)
  const detail =
    opening?.type === 'text' ? [{ ...opening, value: opening.value.trimStart() }, ...rest] : rest
  return { status: status.slice(0, lastSpoken + 1), detail }
}

export interface HandlerOptions {
  readonly slug: Slugger
  /**
   * The document's headings, asked for only if a table of contents is rendered.
   * A function so that a document without one never pays to extract them.
   */
  readonly outline: () => readonly OutlineEntry[]
  readonly highlighter?: Highlighter | undefined
  /** SVG drawings by the image URL that shows them (`RenderOptions.drawings`). */
  readonly drawings?: ReadonlyMap<string, string> | undefined
  /**
   * The installed Markdown extensions (ADR-039), asked how each drawing is
   * drawn; without them every drawing is drawn as ADR-036 draws it.
   */
  readonly extensions?: MarkdownRegistry | undefined
  /**
   * Where each drawing placed in the body is collected, sanitised, in document
   * order: the slot is emitted here and filled after the document sanitiser
   * has run (`html.ts`), so that sanitiser never has to admit SVG.
   */
  readonly placed?: Element[] | undefined
  /** The organisation's label names (`RenderOptions.labels`). */
  readonly labels?: ReadonlySet<string> | undefined
  /** The emoji a label's pill leads with, by label name (`RenderOptions.labelEmoji`). */
  readonly labelEmoji: (label: string) => ResolvedEmoji | undefined
}

function element(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

function text(value: string): ElementContent {
  return { type: 'text', value }
}

/** An image without alternative text is decorative, never an unlabelled image. */
function altText(value: string | null | undefined): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The table a figure shows, when it shows exactly one: a bare table, or a
 * `:::table` without a caption of its own, with its options.
 */
function captionedTable(
  subject: DirectiveContent,
): { readonly table: Table; readonly options: TableOptions } | undefined {
  const [only] = subject
  if (subject.length !== 1 || only === undefined) return undefined
  if (only.type === 'table') return { table: only, options: DEFAULT_TABLE_OPTIONS }
  if (only.type !== 'containerDirective' || !claims(tableDirective, only)) return undefined
  const table = tableOf(only)
  const model = tableDirective.parse(only)
  return table === undefined || model.caption !== undefined ? undefined : { table, options: model }
}

/**
 * The caption of a figure, as the content of a table's `<caption>`: one
 * paragraph's words, or several paragraphs as they were written.
 */
function captionContent(
  state: State,
  node: ContainerDirective,
  caption: DirectiveContent,
): ElementContent[] {
  const [only] = caption
  return caption.length === 1 && only?.type === 'paragraph'
    ? state.all(only)
    : state.all({ ...node, children: caption })
}

function capitalise(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

/** Front matter is metadata, not content; it is rendered by the document header. */
function frontMatter(): undefined {
  return undefined
}

/**
 * A directive's attributes, written back the way they were read.
 *
 * `mdast-util-directive` parses `#id` into `id` and `.a.b` into `class`, so they
 * are written back in that shorthand; a valueless attribute keeps its bare name.
 * The result is a text node, so the HTML serialiser escapes it: nothing here can
 * produce markup.
 */
function attributeSource(attributes: DirectiveAttributes | null | undefined): string {
  const written = Object.entries(attributes ?? {}).map(([name, value]) => {
    if (value === null || value === undefined || value === '') return name
    if (name === 'id') return `#${value}`
    if (name === 'class') {
      return value
        .split(/\s+/)
        .filter((each) => each.length > 0)
        .map((each) => `.${each}`)
        .join('')
    }
    return `${name}="${value}"`
  })
  return written.length === 0 ? '' : `{${written.join(' ')}}`
}

/**
 * A directive this renderer has no handler for, written back as the source the
 * author typed: `:name`, `::name`, its `[label]`, and its attributes.
 *
 * ADR-002's degradation rule is that an unknown directive reads as it would in a
 * renderer that never heard of directives at all — and such a renderer shows the
 * literal text, because it never saw a directive in the first place. Emitting
 * only the children instead silently deleted prose: `:` is a directive marker to
 * the parser, so `Ratio 3:2` is a text directive named `2`, and dropping the
 * marker turned it into `Ratio 3`. The label's children go through `state.all`
 * so `:unknown[**bold**]` keeps its formatting.
 */
function directiveSource(
  state: State,
  node: LeafDirective | TextDirective,
  marker: string,
): ElementContent[] {
  const label: ElementContent[] =
    node.children.length === 0 ? [] : [text('['), ...state.all(node), text(']')]
  const attributes = attributeSource(node.attributes)
  return [text(`${marker}${node.name}`), ...label, ...(attributes === '' ? [] : [text(attributes)])]
}

/**
 * The mdast to hast handlers behind `renderHtml`. Every one of them exists to put
 * meaning in the markup: the right element for the job, a name for anything a
 * screen reader would otherwise meet unannounced, and no information carried by
 * position or colour alone (AGENTS.md rule 14).
 */
export function createHandlers(options: HandlerOptions): Handlers {
  const {
    slug,
    outline,
    highlighter,
    drawings,
    extensions,
    placed = [],
    labels = new Set<string>(),
    labelEmoji,
  } = options

  /**
   * A heading, and the permalink after its words. The heading is named by
   * its words alone (`aria-labelledby`): named from its content it would
   * take the anchor's name too, and a list of headings would read "Steps
   * Link to this section: Steps". The anchor stays inside the heading, so it
   * sits on the heading's line and the outline the presenter splits on is
   * untouched. A slug holds no dot, so `title.<slug>` never meets a heading's
   * own id; the sanitiser prefixes both the id and the reference to it.
   */
  const heading = (state: State, node: Heading): Element => {
    const label = toString(node)
    const id = slug(label)
    const title = `title.${id}`
    const anchor = element(
      'a',
      {
        className: ['heading-anchor'],
        // The sanitiser prefixes the `id` it lets through and never the `href`
        // that points at it, so the anchor adds the prefix itself (./slug.ts).
        href: `#${headingId(id)}`,
        'aria-label': `Link to this section: ${label}`,
      },
      [element('span', { 'aria-hidden': 'true' }, [text('#')])],
    )
    return element(`h${node.depth}`, { id, ariaLabelledBy: [title] }, [
      element('span', { id: title }, state.all(node)),
      anchor,
    ])
  }

  const pre = (node: Code): Element => {
    const fence = node.lang ?? ''
    // ADR-030: the server tokenizes and the reader applies ranges, so the block holds
    // exactly one text node and the highlighting is injected, never imported.
    const highlighted = fence.length > 0 ? (highlighter?.(node.value, fence) ?? null) : null
    const resolved = typeof highlighted === 'string' ? null : highlighted
    const tokens = typeof highlighted === 'string' ? highlighted : resolved?.tokens
    // `data-lang` names the language `data-tokens` was produced for whenever the
    // highlighter says which one that was; otherwise the fence tag as written,
    // and only when it reads as a language name at all.
    const language = resolved?.language ?? (FENCE_LANGUAGE.test(fence) ? fence : undefined)
    const properties: Properties = {}
    if (language !== undefined) properties['data-lang'] = language
    if (tokens !== undefined && tokens !== null) properties['data-tokens'] = tokens
    return element('pre', {}, [element('code', properties, [text(node.value)])])
  }

  /** A fenced block in its card (ADR-041), or a diagram slot holding its source. */
  const code = (_state: State, node: Code): Element => {
    const fence = node.lang ?? ''
    return DIAGRAM_LANGUAGES.has(fence)
      ? element('div', { className: ['diagram'], 'data-diagram': fence }, [pre(node)])
      : codeCard(pre(node), codeBlockCaption(node))
  }

  /** Fences shown as tabs (ADR-041); without script, every panel stacked under its name. */
  const codeGroup = (_state: State, node: CodeGroup): Element => codeGroupElement(node, pre)

  /** The browser's own details, in any syntax, and accordions of them (ADR-048). */
  const detailsRenderer = createDetailsRenderer()

  const image = (_state: State, node: Image): Element =>
    element('img', { src: node.url, alt: altText(node.alt), title: node.title ?? undefined }, [])

  const figure = (node: Image, caption: string): Element =>
    element('figure', {}, [
      element('img', { src: node.url, alt: altText(node.alt) }, []),
      element('figcaption', {}, [text(caption)]),
    ])

  /**
   * An SVG image on its own line, drawn inline as a diagram so it takes the
   * page's colours (`drawing.ts` says why, and what is removed on the way).
   * Its alternative text names the drawing and its title captions it, as
   * they would an image. Undefined when there is no drawing to place.
   */
  const drawingFigure = (node: Image): Element | undefined => {
    const markup = drawings?.get(node.url)
    if (markup === undefined) return undefined
    const rendering = extensions?.drawing({ markup }) ?? {
      kind: 'inline',
      markup,
      naturalSize: false,
      data: {},
    }
    const drawing = drawingElement(rendering, {
      url: node.url,
      idPrefix: `${HEADING_ID_PREFIX}d${placed.length + 1}-`,
      label: altText(node.alt),
    })
    if (drawing === null) return undefined
    placed.push(drawing)
    const caption =
      typeof node.title === 'string' && node.title.length > 0
        ? [element('figcaption', {}, [text(node.title)])]
        : []
    return element('figure', {}, [
      element('div', { className: ['diagram'], 'data-diagram': 'svg' }, []),
      ...caption,
    ])
  }

  const paragraph = (state: State, node: Paragraph): ElementContent | ElementContent[] => {
    const [only] = node.children
    if (node.children.length === 1 && only?.type === 'image') {
      const drawn = drawingFigure(only)
      if (drawn !== undefined) return drawn
    }
    const captioned = node.children.flatMap((child) =>
      child.type === 'image' && typeof child.title === 'string' && child.title.length > 0
        ? [{ image: child, caption: child.title }]
        : [],
    )
    if (node.children.length === 1 && captioned.length === 1) {
      return captioned.map((found) => figure(found.image, found.caption))
    }
    return element('p', {}, state.all(node))
  }

  /**
   * A body cell that opens with badges sets them on a line of their own above
   * its detail, the way a status column reads: what state, then why. Any
   * other cell is left exactly as written.
   */
  const cellContent = (state: State, children: readonly PhrasingContent[]): ElementContent[] => {
    const { status, detail } = splitStatus(children, labels)
    if (status.length === 0) return state.all({ type: 'paragraph', children: [...children] })
    const detailBlock =
      detail.length === 0
        ? []
        : [
            element(
              'span',
              { className: ['cell-detail'] },
              state.all({ type: 'paragraph', children: detail }),
            ),
          ]
    return [
      element(
        'span',
        { className: ['cell-status'] },
        state.all({ type: 'paragraph', children: status }),
      ),
      ...detailBlock,
    ]
  }

  const tableBlock = createTableRenderer({ cellContent })

  const table = (state: State, node: Table): Element =>
    tableBlock(state, node, DEFAULT_TABLE_OPTIONS)

  let callouts = 0

  /**
   * A callout, in words as well as colour (WCAG 1.4.1): its title is always
   * shown, and names it. Untitled, the title is its type ("Warning"); with
   * the author's label, the type is still said first ("Tip: Before you
   * begin"), hidden from sight where the colour and icon already show it.
   * Named by reference to the title, so a screen reader says it once.
   */
  const calloutAside = (
    state: State,
    type: CalloutType,
    label: string | undefined,
    body: ElementContent[],
  ): Element => {
    const id = `callout.${(callouts += 1)}`
    const kind = capitalise(type)
    const words =
      label === undefined
        ? [text(kind)]
        : [element('span', { className: ['sr-only'] }, [text(`${kind}: `)]), text(label)]
    return element(
      'aside',
      { className: ['callout', `callout-${type}`], role: 'note', ariaLabelledBy: [id] },
      state.wrap([element('p', { className: ['callout-label'], id }, words), ...body], true),
    )
  }

  const callout = (state: State, node: ContainerDirective): Element => {
    const model = calloutDirective.parse(node)
    return calloutAside(
      state,
      model.type,
      model.label,
      state.all({ ...node, children: model.children }),
    )
  }

  /** A GitHub alert (`> [!WARNING]`) is a callout, titled with its kind as GitHub titles it. */
  const blockquote = (state: State, node: Blockquote): Element => {
    const alert = splitAlert(node)
    if (alert === undefined) {
      return element('blockquote', {}, state.wrap(state.all(node), true))
    }
    // An Obsidian callout's title is the rest of its marker's line; GitHub's has none.
    const title = toString({ type: 'paragraph', children: alert.title }).trim()
    return calloutAside(
      state,
      alert.kind,
      title === '' ? undefined : title,
      state.all({ ...node, children: alert.body }),
    )
  }

  const labelledAside = (
    state: State,
    node: ContainerDirective,
    name: string,
    label: string,
  ): Element =>
    element(
      'aside',
      { className: [name], role: 'note', 'aria-label': label },
      state.wrap(state.all(node), true),
    )

  const labelledSection = (
    state: State,
    node: ContainerDirective,
    name: string,
    label: string,
  ): Element =>
    element(
      'section',
      { className: [name], 'aria-label': label },
      state.wrap(state.all(node), true),
    )

  const figureBlock = (state: State, node: ContainerDirective): Element => {
    const model = figureDirective.parse(node)
    // A figure of one table and its caption is a captioned table: the caption
    // becomes the table's own, which names it, so the two ways of writing a
    // table caption read identically (ADR-040).
    const captioned = captionedTable(model.subject)
    if (captioned !== undefined && model.caption.length > 0) {
      return tableBlock(
        state,
        captioned.table,
        captioned.options,
        captionContent(state, node, model.caption),
      )
    }
    const subject = state.all({ ...node, children: model.subject })
    const caption =
      model.caption.length === 0
        ? []
        : [element('figcaption', {}, state.wrap(state.all({ ...node, children: model.caption })))]
    return element('figure', {}, state.wrap([...subject, ...caption], true))
  }

  const cards = (state: State, node: ContainerDirective): Element => {
    const model = cardsDirective.parse(node)
    const sections = model.cards.map((card) =>
      element(
        'section',
        { className: ['card'] },
        state.wrap(state.all({ ...node, children: card })),
      ),
    )
    return element(
      'div',
      { className: ['cards'], 'data-variant': model.variant },
      state.wrap(sections, true),
    )
  }

  const containerDirective = (
    state: State,
    node: ContainerDirective,
    parent: unknown,
  ): ElementContent | ElementContent[] => {
    if (isDetailsNode(node)) return detailsRenderer.details(state, node, parent)
    if (isAccordion(node)) return detailsRenderer.accordion(state, node)
    if (claims(figureDirective, node)) return figureBlock(state, node)
    if (claims(cardsDirective, node)) return cards(state, node)
    if (claims(tableDirective, node)) {
      const wrapped = tableOf(node)
      // Anything but exactly one table is shown as written (ADR-002).
      if (wrapped === undefined) return state.all(node)
      const model = tableDirective.parse(node)
      const caption = model.caption === undefined ? [] : state.all(model.caption)
      return tableBlock(state, wrapped, model, caption)
    }
    if (claims(layoutDirective, node)) {
      return element(
        'div',
        { className: [`layout-${node.name}`] },
        state.wrap(state.all(node), true),
      )
    }
    if (claims(calloutDirective, node)) return callout(state, node)
    if (claims(guidanceDirective, node)) return labelledAside(state, node, 'guidance', 'Guidance')
    // `:::notes` never reaches a handler: `renderHtml` removes presenter notes
    // from the tree before rendering (`stripPresenterNotes`).
    if (claims(placeholderDirective, node)) {
      return element('div', { className: ['placeholder'] }, state.wrap(state.all(node), true))
    }
    if (claims(optionalDirective, node)) {
      const model = optionalDirective.parse(node)
      return labelledSection(state, node, 'optional', `Optional section: ${model.title ?? ''}`)
    }
    if (claims(repeatDirective, node)) {
      const model = repeatDirective.parse(node)
      return labelledSection(state, node, 'repeat', `Repeatable section: ${model.title ?? ''}`)
    }
    // ADR-002's degradation rule: an unknown directive renders its children and
    // drops the wrapper, exactly as a Markdown renderer that never heard of it would.
    return state.all(node)
  }

  const textDirective = (state: State, node: TextDirective): ElementContent | ElementContent[] => {
    if (claims(kbdDirective, node)) return element('kbd', {}, state.all(node))
    // A link with a stored choice (ADR-042): an ordinary anchor the page may later fill.
    if (claims(linkDirective, node)) return linkSlot(linkDirective.parse(node))
    // A badge with no label is the author's own text — `status:ok` parses as
    // a directive named `ok` — so it is written back as it was typed.
    if (claims(badgeDirective, node) && toString(node).trim().length > 0) {
      const model = badgeDirective.parse(node)
      return element('span', { className: ['badge'], 'data-tone': model.tone }, [text(model.label)])
    }
    if (isLabel(node, labels)) {
      // A label whose organisation gave it an emoji leads with it in place
      // of the colour dot (ADR-038); the words still say what it is.
      const lead = labelEmoji(node.name)
      return element('span', { className: ['badge'], 'data-label': node.name }, [
        ...(lead === undefined ? [] : [emojiElement(lead, 'decoration')]),
        text(toString(node)),
      ])
    }
    if (claims(smallDirective, node)) return element('small', {}, state.all(node))
    if (claims(placeholderDirective, node)) {
      return element('span', { className: ['placeholder'] }, state.all(node))
    }
    return directiveSource(state, node, ':')
  }

  const outlineList = (entries: readonly OutlineEntry[]): Element =>
    element(
      'ol',
      {},
      entries.map((entry) =>
        element('li', {}, [
          element('a', { href: `#${entry.id}` }, [text(entry.text)]),
          ...(entry.children.length === 0 ? [] : [outlineList(entry.children)]),
        ]),
      ),
    )

  /**
   * `::toc` is a function of the headings and nothing else, so it is rendered
   * into the body rather than left as a slot (ADR-031). A document with nothing
   * for it to list renders nothing: an empty navigation landmark is noise.
   */
  const tableOfContents = (node: LeafDirective): Element | undefined => {
    const { min, max } = tocDirective.parse(node)
    const entries = outlineWithin(outline(), min, max)
    if (entries.length === 0) return undefined
    return element('nav', { className: ['toc'], 'aria-label': 'Table of contents' }, [
      outlineList(entries),
    ])
  }

  /**
   * A leaf directive with no handler: the slot shape of ADR-032, holding the
   * directive's readable fallback.
   *
   * `::name{…}` is the live-block syntax, and until a block type is registered
   * (M5) there is nothing to fill a slot with — but a reader must still see
   * *something*, which before this was an empty string: the whole line vanished
   * from the rendered document. The section names the block's type and carries
   * the parameters as text, which is exactly what ADR-002 asks an unknown
   * directive to degrade to.
   *
   * `::children` is the first block type that has a slot to fill: its depth is a
   * parameter the application reads off the slot (`data-depth`) to list the tree
   * under the document.
   */
  const leafDirective = (state: State, node: LeafDirective): Element | undefined => {
    if (claims(tocDirective, node)) return tableOfContents(node)
    if (claims(linkDirective, node)) {
      const slot = linkSlot(linkDirective.parse(node))
      return slot.type === 'element' ? slot : element('p', {}, [slot])
    }
    const parameters: Properties = claims(childrenDirective, node)
      ? { 'data-depth': String(childrenDirective.parse(node).depth) }
      : {}
    return element(
      'section',
      {
        className: ['live-block'],
        'data-live-block': node.name,
        'aria-label': `Live block: ${node.name}`,
        ...parameters,
      },
      state.wrap([element('p', {}, directiveSource(state, node, '::'))], true),
    )
  }

  return {
    yaml: frontMatter,
    blockquote,
    heading,
    listItem,
    code,
    codeGroup,
    details: (state: State, node: Details, parent: unknown) =>
      detailsRenderer.details(state, node, parent),
    image,
    paragraph,
    table,
    containerDirective,
    leafDirective,
    textDirective,
  }
}
