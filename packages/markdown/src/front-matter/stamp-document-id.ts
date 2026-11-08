import { isMap, isScalar, parseDocument } from 'yaml'

const FENCE = '---'
const BYTE_ORDER_MARK = '\uFEFF'

/**
 * A file read from someone else's repository, as Quill stores it: the given
 * `id` first in its front matter, and every other byte as the file had it
 * (ADR-061, "Identity without front matter").
 *
 * The repository's file never carries Quill's identity, and an `id` it does
 * declare is replaced, so a copied file can never claim another document's
 * identity. The id is the first line of the block because that is where the
 * content store looks for it. The body is never re-serialised: the stored text
 * differs from the repository's only in its front matter, so a compare never
 * shows changes nobody made.
 *
 * Front matter that does not parse as a YAML mapping is kept exactly as
 * written beneath the id (AGENTS.md rule 7), so nothing in it is lost.
 */
export function stampDocumentId(markdown: string, id: string): string {
  const source = markdown.startsWith(BYTE_ORDER_MARK) ? markdown.slice(1) : markdown
  const block = frontMatterBlock(source)
  if (block === null) return `${FENCE}\nid: ${id}\n${FENCE}\n${source}`
  const rest = withoutId(block.yaml)
  return `${FENCE}\nid: ${id}\n${rest.length === 0 ? '' : `${rest}\n`}${FENCE}\n${block.body}`
}

interface FrontMatterBlock {
  readonly yaml: string
  readonly body: string
}

/** The text between the fences and what follows the closing one, or null with no block. */
function frontMatterBlock(source: string): FrontMatterBlock | null {
  const opening = /^---\r?\n/.exec(source)
  if (opening === null) return null
  const lines = source.slice(opening[0].length).split('\n')
  const closing = lines.findIndex((line) => line.replace(/\r$/, '') === FENCE)
  if (closing === -1) return null
  return {
    yaml: lines.slice(0, closing).join('\n'),
    body: lines.slice(closing + 1).join('\n'),
  }
}

/**
 * The block without its own `id`, cut out of the text rather than re-serialised,
 * so every other key keeps its quoting, comments and order. A block that does
 * not parse, or is not a mapping, is kept as written: the id above it is the
 * one the store finds.
 */
function withoutId(yaml: string): string {
  const document = parseDocument(yaml)
  const contents = document.contents
  if (document.errors.length > 0 || !isMap(contents)) return yaml.trimEnd()
  if (contents.flow === true) {
    // A block key cannot sit above a flow mapping, so the mapping becomes a block.
    document.delete('id')
    contents.flow = false
    return contents.items.length === 0 ? '' : String(document).trimEnd()
  }
  let text = yaml
  for (const { key, value } of contents.items.toReversed()) {
    if (!isScalar(key) || key.value !== 'id') continue
    // A pair's value ends after its trailing comment and line break, so the
    // whole entry goes, however many lines its value spans. An entry starts
    // at its line, which holds the `?` of an explicit key.
    const start = text.lastIndexOf('\n', key.range[0]) + 1
    const end = value === null ? lineEnd(text, key.range[2]) : value.range[2]
    text = text.slice(0, start) + text.slice(end)
  }
  return text.trimEnd()
}

/** Just past the line break that ends the line holding `index`, or the end of the text. */
function lineEnd(text: string, index: number): number {
  const lineBreak = text.indexOf('\n', index)
  return lineBreak === -1 ? text.length : lineBreak + 1
}
