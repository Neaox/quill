import type { Element, ElementContent, Properties } from 'hast'
import type { RootContent } from 'mdast'

import type { PropSchemas, PropValues } from './props.ts'

/**
 * A component block (ADR-060): one definition that says what a directive
 * means, what it may hold, which props it takes, and how it is drawn.
 *
 * A block is written in the `directives` dialect, and `content` chooses the
 * form:
 *
 * | `content`                   | Written as                          |
 * | --------------------------- | ----------------------------------- |
 * | `none`                      | a leaf, `::name[label]{props}`      |
 * | `inline`                    | text, `:name[content]{props}`       |
 * | `blocks`                    | a container, `:::name[label]{props}`|
 * | `{ items: 'child' }`        | a container of `child` blocks       |
 *
 * A container that holds another container is written with more colons, as
 * every directive is: `::::timeline` around `:::step`. The parser counts
 * them and the serialiser writes them back as they were.
 *
 * `render` is pure: it is given typed props and the already-rendered label,
 * content and items, and returns hast. It never returns a string of HTML,
 * so a prop can only ever reach the page as text or as an attribute value.
 * Its output is drawn through the document sanitiser like everything else
 * (`render.ts` says what that admits).
 */

/** What a block holds between its fences, or in its brackets. */
export type BlockContent =
  | 'none'
  | 'inline'
  | 'blocks'
  /** A container whose children are blocks named `items`; `body` admits Markdown before them. */
  | { readonly items: string; readonly body?: boolean | undefined }

/** Whether a leaf or container takes a `[label]`, which is inline Markdown. */
export type BlockLabel = 'none' | 'optional' | 'required'

export interface BlockRenderInput<Props extends PropSchemas> {
  /** The props as read: typed, with defaults, and without any value that did not fit. */
  readonly props: PropValues<Props>
  /** The rendered `[label]`, or nothing. Phrasing content. */
  readonly label: readonly ElementContent[]
  /** The label's words, for an accessible name; empty when there is none. */
  readonly labelText: string
  /**
   * The rendered content: a container's blocks (for an `items` block, the
   * Markdown that is not one of its items), or an inline block's phrasing.
   */
  readonly content: readonly ElementContent[]
  /** An `items` container's rendered child blocks, in order. */
  readonly items: readonly ElementContent[]
  /**
   * The Markdown `content` was drawn from, as parsed (mdast): a container's
   * blocks after its label (for an `items` block, the ones that are not its
   * items), or an inline block's phrasing. Emoji are already read: a
   * shortcode the page draws is a text node carrying its element, which
   * `isEmojiText` recognises. For a block whose meaning is in the shape of
   * what is written inside it, such as a step's first line or a cast's list,
   * and drawn again through `draw`.
   */
  readonly children: readonly RootContent[]
  /**
   * Draws Markdown the block has taken apart, exactly as the rest of the page
   * is drawn: phrasing as phrasing, blocks as blocks. Deterministic, like
   * everything a render is given.
   */
  readonly draw: (nodes: readonly RootContent[]) => ElementContent[]
  /**
   * The emoji a name draws on this page (ADR-038), or undefined when there
   * is none: for a prop that names one, such as a step's `icon`. A
   * `decoration` beside words that already say what it is has no name of its
   * own; a `text` one is named by what it shows.
   */
  readonly emoji: (name: string, use: 'text' | 'decoration') => Element | undefined
}

/**
 * Thrown by a `render` that cannot draw what it was given: the block is drawn
 * as the frame of a block that cannot be drawn, with this message as the
 * reason, and the document's health reports it. A render that throws
 * anything else is reported as one that "could not be drawn".
 */
export class BlockRenderError extends Error {
  override readonly name = 'BlockRenderError'
}

export interface BlockDefinition<Props extends PropSchemas = PropSchemas> {
  /** Unique and stable, dotted: `quill.endpoint`, `acme.release`. */
  readonly id: string
  /** Semver. Joins the render cache key, so upgrading a block re-renders the bodies it draws. */
  readonly version: string
  /** The directive name: lower case letters, digits and hyphens, starting with a letter. */
  readonly name: string
  /** What the editor and an issue call it: "API endpoint". */
  readonly title: string
  readonly description: string
  readonly content: BlockContent
  /** Defaults to `none`. An inline block's brackets are its content, never a label. */
  readonly label?: BlockLabel | undefined
  /**
   * The blocks this one may sit directly inside, by name; anywhere when
   * absent. A `step` that only means something on a timeline says so.
   */
  readonly within?: readonly string[] | undefined
  readonly props: Props
  /**
   * The `data-qb-*` attributes `render` may put on its elements. Granted
   * to the sanitiser by name, with any text as a value; any other data
   * attribute is removed.
   */
  readonly data?: readonly string[] | undefined
  render(input: BlockRenderInput<Props>): Element
}

/** Any block, whatever its props: what the registry and the renderer hold. */
export interface AnyBlock {
  readonly id: string
  readonly version: string
  readonly name: string
  readonly title: string
  readonly description: string
  readonly content: BlockContent
  readonly label?: BlockLabel | undefined
  readonly within?: readonly string[] | undefined
  readonly props: PropSchemas
  readonly data?: readonly string[] | undefined
  render(input: BlockRenderInput<PropSchemas>): Element
}

/** Declares a block, typed against its own props. The registry checks the rest. */
export function defineBlock<const Props extends PropSchemas>(
  definition: BlockDefinition<Props>,
): AnyBlock {
  // `render` is a method, so it is compared bivariantly: the registry only
  // ever calls it with props read against this block's own schemas.
  return definition
}

/** The directive form a block is written in. */
export function blockKind(block: AnyBlock): 'container' | 'leaf' | 'text' {
  if (block.content === 'none') return 'leaf'
  if (block.content === 'inline') return 'text'
  return 'container'
}

/** The name of the blocks an `items` container holds, or undefined. */
export function itemsOf(block: AnyBlock): string | undefined {
  return typeof block.content === 'object' ? block.content.items : undefined
}

/** Whether an `items` container also takes Markdown that is not one of its items. */
export function takesBody(block: AnyBlock): boolean {
  return typeof block.content === 'object' && block.content.body === true
}

type Child = ElementContent | string | null | undefined | false | readonly Child[]

function isList(child: Child): child is readonly Child[] {
  return Array.isArray(child)
}

function flatten(children: readonly Child[]): ElementContent[] {
  return children.flatMap((child): ElementContent[] => {
    if (child === null || child === undefined || child === false) return []
    if (typeof child === 'string') return [{ type: 'text', value: child }]
    if (isList(child)) return flatten(child)
    return [child]
  })
}

/**
 * Builds a hast element: a block's `render` is written with this. A string
 * child is a text node, so it is escaped when the page is written; there is
 * no way to pass markup through.
 */
export function h(tagName: string, properties: Properties, ...children: readonly Child[]): Element {
  return { type: 'element', tagName, properties, children: flatten(children) }
}

export const BLOCK_ID = /^[a-z][a-z\d-]*(?:\.[a-z][a-z\d-]*)+$/
export const BLOCK_NAME = /^[a-z][a-z\d-]*$/
const SEMVER = /^\d+\.\d+\.\d+$/
/** The only data attributes a block's render may emit. */
export const BLOCK_DATA_ATTRIBUTE = /^data-qb-[a-z][a-z\d-]*$/
const PROP_NAME = /^[a-z][a-zA-Z\d-]*$/

/**
 * Why a block cannot be registered, or nothing when it can. The registry
 * refuses such a block at construction, so a broken one stops the process at
 * boot rather than misbehaving in one document.
 */
export function blockProblems(block: AnyBlock): readonly string[] {
  const props = Object.entries(block.props)
  const items = itemsOf(block)
  return [
    ...(BLOCK_ID.test(block.id) ? [] : [`its id "${block.id}" is not dotted lower case`]),
    ...(SEMVER.test(block.version) ? [] : [`its version "${block.version}" is not semver`]),
    ...(BLOCK_NAME.test(block.name) ? [] : [`its name "${block.name}" is not a directive name`]),
    ...(block.title.trim() === '' ? ['it has no title'] : []),
    ...(items === undefined || BLOCK_NAME.test(items)
      ? []
      : [`its items "${items}" is not a directive name`]),
    ...(block.content === 'inline' && (block.label ?? 'none') !== 'none'
      ? ['an inline block cannot take a label: its brackets are its content']
      : []),
    ...props.flatMap(([name, schema]) => [
      ...(PROP_NAME.test(name) ? [] : [`its prop "${name}" is not an attribute name`]),
      ...(schema.title.trim() === '' ? [`its prop "${name}" has no title`] : []),
    ]),
    ...(block.data ?? []).flatMap((name) =>
      BLOCK_DATA_ATTRIBUTE.test(name) ? [] : [`its grant names "${name}", which is not data-qb-*`],
    ),
  ]
}
