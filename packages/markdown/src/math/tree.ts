import temml from 'temml'

import { MATH_ATTRIBUTES, MATH_CLASS, MATH_TAGS, STYLE_CLASSES } from './grant.ts'

/**
 * A formula's MathML, as a tree of plain objects (ADR-064): Temml's output,
 * made from TeX and read off Temml's own tree rather than parsed back out of
 * its markup, and kept to what `grant.ts` allows.
 *
 * The one tree is drawn two ways, which is why it is neutral: to hast for a
 * document the server renders (`render.ts`), and to DOM nodes for the editor's
 * preview (`@quill/editor`). Neither has to know anything about Temml, and the
 * cleaning of its output is written once.
 */

export interface MathElement {
  readonly tag: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: readonly (MathElement | string)[]
}

/** A formula as MathML, or why it is not one. */
export type MathRendering =
  | { readonly kind: 'math'; readonly math: MathElement }
  | { readonly kind: 'error'; readonly message: string }

/**
 * What a formula may cost. TeX is a programming language (Temml is a deliberately small part of it,
 * and does not run macros that loop for ever), but its input is an author's and a document may hold
 * thousands: a formula longer than this is an error rather than a stall.
 */
export const MAX_TEX_LENGTH = 20_000

/**
 * Temml, made safe to run on what anybody can write. It never trusts the author (so `\href`,
 * `\includegraphics`, `\style`, `\class`, `\id` and the like are errors, and it writes no link, no
 * address and no class of its own choosing); it never warns to the console; it stops a size or a
 * macro that is meant to run away. It throws, which `renderMath` turns into an error to show.
 */
const OPTIONS = {
  throwOnError: true,
  trust: false,
  strict: false,
  annotate: false,
  maxSize: [10, 120],
  maxExpand: 500,
}

/* v8 ignore start -- Temml's default export reports both of these; the checks bridge its untyped
 * import, and a dependency that stopped reporting them would fail the engine-version test. */

/** The version the engine reports, or a stable name for one that does not say. */
function versionOf(engine: unknown): string {
  if (typeof engine === 'object' && engine !== null && 'version' in engine) {
    const { version } = engine
    if (typeof version === 'string' && version !== '') return version
  }
  return 'unknown'
}

/** The version of the library that draws math, which is part of what a rendered body was made from. */
export const MATH_ENGINE_VERSION: string = versionOf(temml)

/** Temml's own name for the tree builder it offers beside the string renderer. */
const TREE_BUILDER = '__renderToMathMLTree'

/** The engine's tree builder, or undefined for a library that does not offer one. */
function buildOf(engine: unknown): ((source: string, options: object) => unknown) | undefined {
  if (typeof engine !== 'object' || engine === null) return undefined
  if (!(TREE_BUILDER in engine)) return undefined
  const build = engine[TREE_BUILDER]
  if (typeof build !== 'function') return undefined
  return (source, options) => Reflect.apply(build, engine, [source, options])
}

/* v8 ignore stop */

const TAGS: ReadonlySet<string> = new Set(MATH_TAGS)

/** The shape of the nodes of Temml's tree that are read. Everything else about them is ignored. */
interface TemmlNode {
  readonly type?: string
  readonly attributes?: Readonly<Record<string, unknown>>
  readonly classes?: readonly unknown[]
  readonly style?: Readonly<Record<string, unknown>>
  readonly children: readonly unknown[]
}

interface TemmlText {
  readonly text: string
}

const isText = (value: unknown): value is TemmlText =>
  typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string'

const isNode = (value: unknown): value is TemmlNode =>
  typeof value === 'object' &&
  value !== null &&
  'children' in value &&
  Array.isArray(value.children)

/** `paddingLeft` as CSS writes it, `padding-left`. */
const hyphenate = (property: string): string =>
  property.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)

/** The classes a node's inline style stands in for: each declaration that has one. */
function styleClasses(style: TemmlNode['style']): readonly string[] {
  /* v8 ignore next -- Temml gives every node a style object, empty when it writes no declaration. */
  return Object.entries(style ?? {}).flatMap(([property, value]) => {
    const found = STYLE_CLASSES[`${hyphenate(property)}:${String(value)}`]
    return found === undefined ? [] : [found]
  })
}

/* v8 ignore next -- Temml gives every node a classes array, empty when it names no class. */
const stringsOf = (values: readonly unknown[] | undefined): readonly string[] =>
  (values ?? []).filter((value): value is string => typeof value === 'string')

function attributesOf(node: TemmlNode): Record<string, string> {
  /* v8 ignore next -- Temml gives every node an attributes object, empty when it writes none. */
  const attributes = Object.fromEntries(
    Object.entries(node.attributes ?? {}).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && MATH_ATTRIBUTES[entry[0]]?.test(entry[1]) === true,
    ),
  )
  const classes = [...new Set([...stringsOf(node.classes), ...styleClasses(node.style)])].filter(
    (name) => MATH_CLASS.test(name),
  )
  return classes.length === 0 ? attributes : { ...attributes, class: classes.join(' ') }
}

/** A node of Temml's tree as the nodes it becomes: none for what is not an element we allow, its children for a wrapper. */
function convert(node: unknown): readonly (MathElement | string)[] {
  if (isText(node)) return [node.text]
  /* v8 ignore next -- every value in Temml's tree that is not text has children. */
  if (!isNode(node)) return []
  const children = node.children.flatMap(convert)
  // A fragment, or an element this does not allow (`semantics`, `maction`): its content is kept.
  if (node.type === undefined || !TAGS.has(node.type)) return children
  return [{ tag: node.type, attributes: attributesOf(node), children }]
}

/** Why Temml refused a formula, in a line: its message without the context it quotes. */
function messageOf(error: unknown): string {
  /* v8 ignore next -- Temml throws an Error; anything else is a bug this must still survive. */
  if (!(error instanceof Error)) return 'This formula could not be drawn.'
  const [first = ''] = error.message.trim().split(/ at (?:position \d+|end of input)/u)
  /* v8 ignore next -- Temml's message has words before the position it appends. */
  return first.trim() === '' ? 'This formula could not be drawn.' : first.trim()
}

/** The root `math` element of a tree Temml built: the one element of the conversion. */
function rootOf(built: unknown): MathElement | undefined {
  const [first] = convert(built)
  /* v8 ignore next -- Temml's root is the `math` element, never a text node. */
  return typeof first === 'object' ? first : undefined
}

/**
 * Draws TeX as MathML. Pure: the same TeX is the same tree. It does not throw: a formula Temml
 * cannot read is `{kind:'error'}` with a line to say why, because a document with a mistake in
 * one formula is still a document.
 */
export function renderMath(tex: string, display: boolean): MathRendering {
  if (tex.length > MAX_TEX_LENGTH) {
    return { kind: 'error', message: `This formula is longer than ${MAX_TEX_LENGTH} characters.` }
  }
  try {
    const build = buildOf(temml)
    /* v8 ignore next -- Temml always offers the tree builder the version check found. */
    if (build === undefined) return { kind: 'error', message: 'This formula could not be drawn.' }
    const math = rootOf(build(tex, { ...OPTIONS, displayMode: display }))
    /* v8 ignore next 3 -- the engine either builds a `math` root or throws. */
    return math === undefined
      ? { kind: 'error', message: 'This formula could not be drawn.' }
      : { kind: 'math', math }
  } catch (error) {
    return { kind: 'error', message: messageOf(error) }
  }
}
