import { toString } from 'mdast-util-to-string'
import type { Element, ElementContent, Properties } from 'hast'
import type { AlignType, Code, Heading, Image, Paragraph, Table, TableRow } from 'mdast'
import type { ContainerDirective, LeafDirective, TextDirective } from 'mdast-util-directive'
import type { Options as ToHastOptions } from 'remark-rehype'

import { calloutDirective } from '../directives/callout.ts'
import type { DirectiveAttributes } from '../directives/definition.ts'
import { claims } from '../directives/definition.ts'
import { guidanceDirective } from '../directives/guidance.ts'
import { kbdDirective } from '../directives/kbd.ts'
import { layoutDirective } from '../directives/layout.ts'
import { optionalDirective } from '../directives/optional.ts'
import { placeholderDirective } from '../directives/placeholder.ts'
import { repeatDirective } from '../directives/repeat.ts'
import type { Slugger } from './slug.ts'
import { headingId } from './slug.ts'

/** The handler map `remark-rehype` takes, and the state it passes each handler. */
export type Handlers = NonNullable<ToHastOptions['handlers']>
type Handler = NonNullable<Handlers['heading']>
type State = Parameters<Handler>[0]

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

export interface HandlerOptions {
  readonly slug: Slugger
  readonly highlighter?: Highlighter | undefined
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

function alignClass(align: AlignType | undefined): string[] {
  return align === null || align === undefined ? [] : [`align-${align}`]
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
  const { slug, highlighter } = options

  const heading = (state: State, node: Heading): Element => {
    const label = toString(node)
    const id = slug(label)
    const anchor = element(
      'a',
      {
        className: ['heading-anchor'],
        // The sanitiser prefixes the `id` it lets through and never the `href`
        // that points at it, so the anchor adds the prefix itself (./slug.ts).
        href: `#${headingId(id)}`,
        'aria-label': `Permalink: ${label}`,
      },
      [text('#')],
    )
    return element(`h${node.depth}`, { id }, [...state.all(node), anchor])
  }

  const code = (_state: State, node: Code): Element => {
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

  const image = (_state: State, node: Image): Element =>
    element('img', { src: node.url, alt: altText(node.alt), title: node.title ?? undefined }, [])

  const figure = (node: Image, caption: string): Element =>
    element('figure', {}, [
      element('img', { src: node.url, alt: altText(node.alt) }, []),
      element('figcaption', {}, [text(caption)]),
    ])

  const paragraph = (state: State, node: Paragraph): ElementContent | ElementContent[] => {
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

  const cellProperties = (align: AlignType | undefined, head: boolean): Properties => {
    const classes = alignClass(align)
    const properties: Properties = head ? { scope: 'col' } : {}
    if (classes.length > 0) properties['className'] = classes
    return properties
  }

  const row = (state: State, node: TableRow, align: readonly AlignType[], head: boolean): Element =>
    element(
      'tr',
      {},
      state.wrap(
        node.children.map((cell, index) =>
          element(head ? 'th' : 'td', cellProperties(align[index], head), state.all(cell)),
        ),
        true,
      ),
    )

  const table = (state: State, node: Table): Element => {
    const align = node.align ?? []
    const head = node.children.slice(0, 1)
    const body = node.children.slice(1)
    const sections = [
      ...head.map((first) =>
        element('thead', {}, state.wrap([row(state, first, align, true)], true)),
      ),
      ...(body.length > 0
        ? [
            element(
              'tbody',
              {},
              state.wrap(
                body.map((each) => row(state, each, align, false)),
                true,
              ),
            ),
          ]
        : []),
    ]
    return element('table', {}, state.wrap(sections, true))
  }

  const callout = (state: State, node: ContainerDirective): Element => {
    const model = calloutDirective.parse(node)
    const label = model.label ?? capitalise(model.type)
    const labelBlock =
      model.label === undefined
        ? []
        : [element('p', { className: ['callout-label'] }, [text(model.label)])]
    const body = state.all({ ...node, children: model.children })
    return element(
      'aside',
      { className: ['callout', `callout-${model.type}`], role: 'note', 'aria-label': label },
      state.wrap([...labelBlock, ...body], true),
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

  const containerDirective = (
    state: State,
    node: ContainerDirective,
  ): ElementContent | ElementContent[] => {
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
    if (claims(placeholderDirective, node)) {
      return element('span', { className: ['placeholder'] }, state.all(node))
    }
    return directiveSource(state, node, ':')
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
   */
  const leafDirective = (state: State, node: LeafDirective): Element =>
    element(
      'section',
      {
        className: ['live-block'],
        'data-live-block': node.name,
        'aria-label': `Live block: ${node.name}`,
      },
      state.wrap([element('p', {}, directiveSource(state, node, '::'))], true),
    )

  return {
    yaml: frontMatter,
    heading,
    code,
    image,
    paragraph,
    table,
    containerDirective,
    leafDirective,
    textDirective,
  }
}
