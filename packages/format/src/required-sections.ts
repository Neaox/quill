/**
 * Which of a document's required sections are still empty (ADR-029).
 *
 * "Required" is a business rule the platform records and shows, never one it
 * enforces: a section whose heading is missing, or which holds nothing once
 * authoring scaffolding has been stripped, is reported so the publish summary
 * and the document's health signals can say so plainly — and the publish goes
 * ahead either way.
 *
 * The check reads the Markdown rather than the tree, because that is the form
 * a publish produces and a reader is shown, and because a heading with nothing
 * beneath it is exactly as visible in one as in the other.
 */

const HEADING = /^#{1,6}\s+\S/
const TRAILING_HASHES = /\s*#*\s*$/
const FENCE = /^\s*(?:```|~~~)/
const FRONT_MATTER = /^---\s*$/

/** Stands in for any line inside a fenced block: content, never a heading. */
const CODE = 'code'

export function incompleteRequiredSections(
  markdown: string,
  required: readonly string[],
): readonly string[] {
  if (required.length === 0) return []
  const filled = filledHeadings(markdown)
  return required.filter((heading) => !filled.has(normalise(heading)))
}

interface Heading {
  readonly depth: number
  readonly text: string
}

/** The heading a line opens, or null when the line is not one. */
function headingOf(line: string): Heading | null {
  if (!HEADING.test(line)) return null
  const depth = leadingHashes(line)
  return { depth, text: normalise(line.slice(depth).replace(TRAILING_HASHES, '')) }
}

function leadingHashes(line: string): number {
  let depth = 0
  while (line[depth] === '#') depth += 1
  return depth
}

/**
 * Every heading in the document that has something under it.
 *
 * Sections nest, so the walk keeps the headings it is inside: a subheading is
 * content of the section it sits in, while a heading at the same level or
 * above closes it instead.
 */
function filledHeadings(markdown: string): ReadonlySet<string> {
  const filled = new Set<string>()
  const open: Heading[] = []

  for (const line of bodyLines(markdown)) {
    const heading = headingOf(line)
    if (heading !== null) {
      for (let last = open.at(-1); last !== undefined; last = open.at(-1)) {
        if (last.depth < heading.depth) break
        open.pop()
      }
      const parent = open.at(-1)
      if (parent !== undefined) filled.add(parent.text)
      open.push(heading)
      continue
    }
    const innermost = open.at(-1)
    if (innermost !== undefined && line.trim().length > 0) filled.add(innermost.text)
  }

  return filled
}

/** The body, with front matter and the inside of fenced code blocks left out. */
function* bodyLines(markdown: string): Generator<string> {
  let first = true
  let inFrontMatter = false
  let fenced = false

  for (const line of markdown.split('\n')) {
    if (first) {
      first = false
      if (FRONT_MATTER.test(line)) {
        inFrontMatter = true
        continue
      }
    }
    if (inFrontMatter) {
      if (FRONT_MATTER.test(line)) inFrontMatter = false
      continue
    }
    if (FENCE.test(line)) {
      fenced = !fenced
      // The fence itself is content of whatever section it sits in.
      yield CODE
      continue
    }
    yield fenced ? CODE : line
  }
}

function normalise(heading: string): string {
  return heading.trim().toLowerCase()
}
