import {
  closingLine,
  dedent,
  firstOf,
  indentOf,
  jsxAttribute,
  rewriteBlocks,
} from './code-groups.ts'

/**
 * Converters from other platforms' collapsible sections into Quill's
 * `:::details` (ADR-048), for the importer (quill-plan.md M4). Pure string to
 * string, like the code-group converters beside them, whose line handling
 * they share.
 *
 * These syntaxes are imported, never read live:
 *
 * - **Material for MkDocs** (`pymdownx.details`): `??? note "Title"`, or
 *   `???+` for one that starts open, followed by indented content.
 *   CommonMark reads that as a paragraph and an indented code block, so
 *   reading it live would change how core syntax parses (ADR-039).
 * - **VitePress**: `::: details Title` … `:::`. The space makes it no
 *   directive, so CommonMark reads a paragraph, and the title, the body's
 *   first lines and the closing colons run into that one paragraph unless
 *   blank lines separate them. Recognising it in the tree, as `::: code-group`
 *   is (ADR-041), would work only for the documents that happen to be spaced
 *   out, so it is converted instead.
 * - **MDX components**: Fumadocs' `<Accordions>` and `<Accordion title>`,
 *   and Mintlify's `<AccordionGroup>`. JSX is not Markdown (ADR-032).
 *
 * GitHub's `<details>` (also what Docusaurus and Starlight write) and
 * Obsidian's foldable callouts are read live and need no converting.
 */

/** A title as a directive label: brackets escaped, so it cannot close the label early. */
function label(title: string | undefined): string {
  const trimmed = title?.trim() ?? ''
  return trimmed === '' ? '' : `[${trimmed.replaceAll(/[[\]]/gu, '\\$&')}]`
}

/** The colons a container needs to hold `lines`: one more than the longest fence inside it. */
function fenceFor(lines: readonly string[]): string {
  const deepest = Math.max(2, ...lines.map((line) => /^\s*(:{3,})/u.exec(line)?.[1]?.length ?? 0))
  return ':'.repeat(deepest + 1)
}

/** A container directive around `body`, at `indent`, its fence long enough for what it holds. */
function container(name: string, indent: string, heading: string, body: readonly string[]): string {
  const fence = fenceFor(body)
  const indented = body.map((line) => (line === '' ? '' : `${indent}${line}`))
  return [`${indent}${fence}${name}${heading}`, ...indented, `${indent}${fence}`].join('\n')
}

/** Lines without the blank ones they end on. */
function trimTrailing(lines: readonly string[]): string[] {
  const last = lines.findLastIndex((line) => line.trim() !== '')
  return lines.slice(0, last + 1)
}

/* --- Material for MkDocs ------------------------------------------------- */

/** `??? type "Title"`, `???+ type`, extra classes after the type allowed. */
const MKDOCS_DETAILS = /^(\s*)\?\?\?(\+)?(?:\s+([\w-]+)(?:\s+[\w-]+)*)?(?:\s+"([^"]*)")?\s*$/u

function mkdocsEnd(rest: readonly string[]): number | undefined {
  const opening = MKDOCS_DETAILS.exec(firstOf(rest))
  if (opening === null) return undefined
  /* v8 ignore next -- the first group of the pattern always takes part in a match. */
  const depth = (opening[1] ?? '').length + 4
  let end: number | undefined
  for (const [index, line] of rest.entries()) {
    if (index === 0 || line.trim() === '') continue
    if (indentOf(line) < depth) break
    end = index
  }
  return end
}

function mkdocsDetails(block: readonly string[]): string {
  /* v8 ignore next -- a block is only converted after `mkdocsEnd` matched its first line. */
  const [, indent = '', open, type, title] = MKDOCS_DETAILS.exec(firstOf(block)) ?? []
  const depth = indent.length + 4
  const content = block.slice(1).map((line) => line.slice(depth))
  const body = importMkDocsDetails(content.join('\n')).split('\n')
  const attributes = [type === undefined ? '' : `type=${type}`, open === undefined ? '' : 'open']
    .filter((part) => part !== '')
    .join(' ')
  return container(
    'details',
    indent,
    `${label(title)}${attributes === '' ? '' : `{${attributes}}`}`,
    body,
  )
}

/** Material for MkDocs' collapsible blocks (`???`, `???+`) as details, keeping their kind. */
export function importMkDocsDetails(markdown: string): string {
  return rewriteBlocks(markdown, mkdocsEnd, mkdocsDetails)
}

/* --- VitePress ----------------------------------------------------------- */

const VITEPRESS_DETAILS = /^(\s*)(:{3,})\s*details(?:\s+(.*?))?\s*$/u

function vitepressEnd(rest: readonly string[]): number | undefined {
  const opening = VITEPRESS_DETAILS.exec(firstOf(rest))
  if (opening === null) return undefined
  /* v8 ignore next -- the colons of the pattern always take part in a match. */
  const length = (opening[2] ?? '').length
  // markdown-it-container closes at the first line of at least as many colons.
  const end = rest.findIndex(
    (line, index) => index > 0 && /^\s*:+\s*$/u.test(line) && line.trim().length >= length,
  )
  return end === -1 ? undefined : end
}

function vitepressDetails(block: readonly string[]): string {
  /* v8 ignore next -- a block is only converted after `vitepressEnd` matched its first line. */
  const [, indent = '', colons = ':::', title] = VITEPRESS_DETAILS.exec(firstOf(block)) ?? []
  const body = importVitePressDetails(block.slice(1, -1).join('\n'))
  return [`${indent}${colons}details${label(title)}`, body, `${indent}${colons}`].join('\n')
}

/** VitePress's `::: details Title` containers as details. Its other containers are left alone. */
export function importVitePressDetails(markdown: string): string {
  return rewriteBlocks(markdown, vitepressEnd, vitepressDetails)
}

/* --- MDX: Fumadocs and Mintlify ------------------------------------------ */

const ACCORDION_OPEN = /^\s*<Accordion(\s[^>]*)?>\s*$/u
const ACCORDION_CLOSE = /^\s*<\/Accordion>\s*$/u
const GROUP_OPEN = /^\s*<(?:Accordions|AccordionGroup)(\s[^>]*)?>\s*$/u
const GROUP_CLOSE = /^\s*<\/(?:Accordions|AccordionGroup)>\s*$/u

function accordion(block: readonly string[]): string {
  /* v8 ignore next -- a block is only converted after its opening line matched. */
  const [, attributes = ''] = ACCORDION_OPEN.exec(firstOf(block)) ?? []
  const body = trimTrailing(dedent(block.slice(1, -1)))
  return container('details', '', label(jsxAttribute(attributes, 'title')), body)
}

/** A group that holds accordions and nothing else, as an accordion; undefined otherwise. */
function accordionGroup(block: readonly string[]): string | undefined {
  const inner = dedent(block.slice(1, -1))
  const find = closingLine(ACCORDION_OPEN, ACCORDION_CLOSE)
  const members: string[] = []
  let from = 0
  while (from < inner.length) {
    const rest = inner.slice(from)
    if (firstOf(rest).trim() === '') {
      from += 1
      continue
    }
    const end = find(rest)
    if (end === undefined) return undefined
    members.push(accordion(rest.slice(0, end + 1)))
    from += end + 1
  }
  return members.length === 0
    ? undefined
    : container('accordion', '', '', members.join('\n').split('\n'))
}

/**
 * Fumadocs' `<Accordions>` and Mintlify's `<AccordionGroup>` as accordions,
 * and every `<Accordion title>` as a details.
 */
export function importMdxAccordions(markdown: string): string {
  const groups = rewriteBlocks(markdown, closingLine(GROUP_OPEN, GROUP_CLOSE), accordionGroup)
  return rewriteBlocks(groups, closingLine(ACCORDION_OPEN, ACCORDION_CLOSE), accordion)
}

/** Every platform's collapsible sections in a document, as Quill's details. */
export function importDetails(markdown: string): string {
  return importMdxAccordions(importVitePressDetails(importMkDocsDetails(markdown)))
}
