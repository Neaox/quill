/**
 * Reading a draw.io file: the diagram source inside a `.drawio.svg`, or a raw
 * `.drawio`, its pages, and the words on them.
 *
 * A `.drawio.svg` carries the editable diagram in its root's `content`
 * attribute: an `<mxfile>` whose `<diagram>` pages are either an
 * `<mxGraphModel>` written out, or that model compressed — URI-encoded, raw
 * deflate, then base64, which is draw.io's own storage form. A raw `.drawio`
 * is the `<mxfile>` itself.
 *
 * Every input here is untrusted, and a compressed page is the classic zip
 * bomb: a few kilobytes that inflate to gigabytes. So inflating is a port the
 * caller supplies with a byte cap it must honour (`Inflate`), the total
 * inflated across every page shares one budget, and the model is scanned, not
 * parsed into a tree, with a cap on the elements it may hold. Past any limit
 * the file is refused as a whole rather than read in part, so a refusal is
 * a fact about the file and not about where a scan happened to stop.
 *
 * Pure apart from the injected `Inflate`, and shared by both surfaces: the
 * server reads labels for search on upload, and the editor reads the source
 * it hands the draw.io editor (`prepareForEditing`).
 */

/** What inflating gave: the bytes, or why there are none. */
export type Inflated =
  | { readonly kind: 'inflated'; readonly bytes: Uint8Array }
  | { readonly kind: 'refused'; readonly reason: 'too-large' | 'malformed' }

/**
 * Inflates raw deflate, refusing to produce more than `maxBytes`: `too-large`
 * when the output would pass the cap, which it must find out without
 * allocating past it, and `malformed` when the bytes are not raw deflate.
 */
export type Inflate = (compressed: Uint8Array, maxBytes: number) => Promise<Inflated>

export interface DrawioLimits {
  /** Bytes inflated across every page of one file. */
  readonly maxInflatedBytes: number
  /** Elements across every page's model. */
  readonly maxElements: number
  /** Pages in one file. */
  readonly maxPages: number
  /** Characters of label text kept, across the file. */
  readonly maxLabelCharacters: number
}

/**
 * Larger than any diagram a person draws by a wide margin — a dense
 * architecture diagram is a few hundred kilobytes of model and a few thousand
 * elements — and small enough that a hostile file costs a bounded, small
 * amount of memory and time to refuse.
 */
export const DRAWIO_LIMITS: DrawioLimits = {
  maxInflatedBytes: 8 * 1024 * 1024,
  maxElements: 100_000,
  maxPages: 100,
  maxLabelCharacters: 64 * 1024,
}

export type DrawioRefusal = 'too-large' | 'too-many-elements' | 'too-many-pages' | 'malformed'

export type DrawioModels =
  | { readonly kind: 'models'; readonly models: readonly string[] }
  | { readonly kind: 'not-drawio' }
  | { readonly kind: 'refused'; readonly reason: DrawioRefusal }

export type DrawioLabels =
  | { readonly kind: 'labels'; readonly labels: readonly string[] }
  | { readonly kind: 'not-drawio' }
  | { readonly kind: 'refused'; readonly reason: DrawioRefusal }

/** The root `<svg …>` start tag; attribute values are quoted, so a `>` inside one is skipped. */
const SVG_START_TAG = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/i

/** draw.io writes its attributes double-quoted, with `"` escaped, so a value never holds one. */
const CONTENT_ATTRIBUTE = /\scontent\s*=\s*"([^"]*)"/i

/** An `<mxfile>` or a bare model, after an optional XML prologue. */
const DRAWIO_ROOT = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:mxfile|mxGraphModel)\b/

/**
 * The diagram source a file carries: the `content` of a `.drawio.svg`, or a
 * `.drawio` as it is. Null when the file holds no draw.io diagram.
 */
export function drawioSourceOf(file: string): string | null {
  if (DRAWIO_ROOT.test(file)) return file
  const start = SVG_START_TAG.exec(file)?.[0]
  const content = start === undefined ? undefined : CONTENT_ATTRIBUTE.exec(start)?.[1]
  if (content === undefined) return null
  const source = decodeEntities(content)
  return DRAWIO_ROOT.test(source) ? source : null
}

/** One `<diagram …>…</diagram>` page; draw.io never nests them. */
const DIAGRAM_PAGE = /<diagram\b(?:[^>"']|"[^"]*"|'[^']*')*?(?:\/>|>([\s\S]*?)<\/diagram>)/g

const BASE64 = /^[A-Za-z\d+/=\s]*$/

/**
 * Every page's model, written out, within the limits. A bare `<mxGraphModel>`
 * file is one page.
 */
export async function readDrawioModels(
  source: string,
  inflate: Inflate,
  limits: DrawioLimits = DRAWIO_LIMITS,
): Promise<DrawioModels> {
  if (!DRAWIO_ROOT.test(source)) return { kind: 'not-drawio' }
  if (!/<mxfile\b/.test(source.slice(0, 1024))) return { kind: 'models', models: [source] }

  const pages = [...source.matchAll(DIAGRAM_PAGE)].map(([, inner = '']) => inner.trim())
  if (pages.length > limits.maxPages) return { kind: 'refused', reason: 'too-many-pages' }

  let budget = limits.maxInflatedBytes
  const models: string[] = []
  for (const page of pages) {
    if (page.startsWith('<')) {
      models.push(page)
      continue
    }
    if (page === '') continue
    if (!BASE64.test(page)) return { kind: 'refused', reason: 'malformed' }
    const inflated = await inflate(base64Bytes(page), budget)
    if (inflated.kind === 'refused') return inflated
    budget -= inflated.bytes.length
    const model = uriDecoded(new TextDecoder('utf-8', { fatal: false }).decode(inflated.bytes))
    if (model === null) return { kind: 'refused', reason: 'malformed' }
    models.push(model)
  }
  return { kind: 'models', models }
}

function base64Bytes(text: string): Uint8Array {
  const binary = atob(text.replaceAll(/\s/g, ''))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

/** draw.io URI-encodes a model before compressing it; a stray `%` makes it unreadable. */
function uriDecoded(text: string): string | null {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

/**
 * A cell that can carry words: `mxCell` with a `value`, or the `object` and
 * `UserObject` wrappers draw.io uses for cells with properties, whose words
 * are in `label`. Attributes are matched quote-aware, so a `>` inside one
 * cannot end the tag.
 */
const LABELLED_ELEMENT =
  /<(mxCell|object|UserObject)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g

const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** Every element start in a model, for the element budget. */
const ELEMENT_START = /<[A-Za-z]/g

/** How many elements a model starts, counted without holding the matches. */
function countElements(model: string): number {
  let count = 0
  // The pattern is global, so each exec resumes where the last match ended.
  while (ELEMENT_START.exec(model) !== null) count += 1
  return count
}

function attributesOf(source: string): ReadonlyMap<string, string> {
  return new Map(
    // Exactly one of the two quoted forms matched.
    Array.from(source.matchAll(ATTRIBUTE), ([, name = '', double = '', single = '']) => [
      name,
      decodeEntities(double + single),
    ]),
  )
}

/**
 * The words on a model's cells, in document order, as a reader would read
 * them: an HTML label's markup removed, its line breaks kept as spaces.
 */
export function labelsOfModel(model: string): readonly string[] {
  return Array.from(model.matchAll(LABELLED_ELEMENT), ([, tag, source = '']) => {
    const attributes = attributesOf(source)
    const raw = tag === 'mxCell' ? attributes.get('value') : attributes.get('label')
    return raw === undefined ? '' : plainText(raw)
  }).filter((label) => label !== '')
}

/**
 * The words of every page of a draw.io file, for search. Bounded in what it
 * inflates, in the elements it will scan, and in the text it keeps.
 */
export async function readDrawioLabels(
  file: string,
  inflate: Inflate,
  limits: DrawioLimits = DRAWIO_LIMITS,
): Promise<DrawioLabels> {
  const source = drawioSourceOf(file)
  if (source === null) return { kind: 'not-drawio' }
  const read = await readDrawioModels(source, inflate, limits)
  if (read.kind !== 'models') return read

  const elements = read.models.reduce((total, model) => total + countElements(model), 0)
  if (elements > limits.maxElements) return { kind: 'refused', reason: 'too-many-elements' }

  const labels: string[] = []
  let room = limits.maxLabelCharacters
  for (const label of read.models.flatMap(labelsOfModel)) {
    if (room <= 0) break
    const kept = label.slice(0, room)
    labels.push(kept)
    room -= kept.length
  }
  return { kind: 'labels', labels }
}

/** An `mxCell` start tag, its attributes, and how it closes. */
const MX_CELL = /<mxCell\b((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)(\s*\/?>)/g
const SHAPE_OR_LINE = /\s(?:vertex|edge)\s*=\s*"1"/
const STYLE_ATTRIBUTE = /(\sstyle\s*=\s*")([^"]*)"/

/**
 * draw.io's per-cell "Convert Labels to SVG" (`convertToSvg=1`), set on a
 * style. In draw.io 32 this is a cell style, not an export option: a cell
 * without it writes its label as HTML in a `foreignObject`, which Quill's
 * allowlist refuses (ADR-043). An SVG label wraps by `svgWhiteSpace`, so a
 * wrapping label keeps wrapping, as draw.io's own toggle does (`Format.js`).
 */
function withSvgLabels(style: string): string {
  const parts = style
    .split(';')
    .filter((part) => part !== '' && !/^(?:convertToSvg|svgWhiteSpace)=/.test(part))
  const wraps = parts.includes('whiteSpace=wrap') || style.includes('svgWhiteSpace=wrap')
  return [...parts, 'convertToSvg=1', ...(wraps ? ['svgWhiteSpace=wrap'] : []), ''].join(';')
}

function withSvgLabelCells(model: string): string {
  return model.replaceAll(MX_CELL, (whole, attributes: string, end: string) => {
    if (!SHAPE_OR_LINE.test(attributes)) return whole
    const styled = STYLE_ATTRIBUTE.test(attributes)
      ? attributes.replace(
          STYLE_ATTRIBUTE,
          (_match, open: string, style: string) => `${open}${withSvgLabels(style)}"`,
        )
      : `${attributes} style="${withSvgLabels('')}"`
    return `<mxCell${styled}${end}`
  })
}

const SVG_LABELS = /(?:^|;)convertToSvg=1(?:;|$)/

/** Whether any shape or line in a model still writes its label as HTML. */
function hasHtmlLabels(model: string): boolean {
  return Array.from(model.matchAll(MX_CELL)).some(([, attributes = '']) => {
    if (!SHAPE_OR_LINE.test(attributes)) return false
    const style = STYLE_ATTRIBUTE.exec(attributes)?.[2] ?? ''
    return !SVG_LABELS.test(style)
  })
}

/** A diagram's source with every label as SVG text, and whether that changed anything. */
export interface EditableDrawioSource {
  readonly kind: 'source'
  readonly xml: string
  /** True when some shape or line was converted: the source differs from what was read. */
  readonly converted: boolean
}

/**
 * The source to open in the draw.io editor: every page written out rather
 * than compressed, and every shape and line set to write its label as SVG
 * text, so what Quill saves is drawn inline, crisp and searchable. A file
 * saved elsewhere with HTML labels is converted the first time it is edited
 * here, which is the "re-save" the legacy fallback offers.
 */
export async function editableDrawioSource(
  file: string,
  inflate: Inflate,
  limits: DrawioLimits = DRAWIO_LIMITS,
): Promise<EditableDrawioSource | Exclude<DrawioModels, { kind: 'models' }>> {
  const source = drawioSourceOf(file)
  if (source === null) return { kind: 'not-drawio' }
  const read = await readDrawioModels(source, inflate, limits)
  if (read.kind !== 'models') return read
  if (!/<mxfile\b/.test(source.slice(0, 1024))) {
    return { kind: 'source', xml: withSvgLabelCells(source), converted: hasHtmlLabels(source) }
  }
  const models = [...read.models]
  // Pages are replaced in the order they were read, so each keeps its own
  // `id` and `name`; an empty page stays empty.
  const xml = source.replaceAll(DIAGRAM_PAGE, (whole, inner: string | undefined) => {
    if (inner === undefined || inner.trim() === '') return whole
    // Every page that is not empty has a model, read in the same order.
    const [model = ''] = models.splice(0, 1)
    const start = whole.slice(0, whole.length - inner.length - '</diagram>'.length)
    return `${start}${withSvgLabelCells(model)}</diagram>`
  })
  return { kind: 'source', xml, converted: read.models.some(hasHtmlLabels) }
}

/** A tag that ends a line of text when an HTML label is read as words. */
const BREAKING_TAG = /<\/?(?:br|div|p|li|tr|h[1-6])\b[^>]*>/gi
const ANY_TAG = /<[^>]*>/g

/**
 * A label as words. An HTML label's entities are decoded after its markup is
 * removed; a plain label holding entity text is decoded too, which loses only
 * the rare label that means `&amp;` literally, and finds it by `&` instead.
 */
function plainText(label: string): string {
  const text = decodeEntities(label.replaceAll(BREAKING_TAG, ' ').replaceAll(ANY_TAG, ''))
  return text.replaceAll(/\s+/g, ' ').trim()
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/**
 * XML's five entities, `&nbsp;` (which an HTML label carries), and numeric
 * references. Anything else is left as written: it is a label's text, and
 * reading it literally loses nothing a search would find.
 */
export function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole
  })
}
