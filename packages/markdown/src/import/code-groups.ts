import { SYNC_KEY } from '../code-group/code-group.ts'

/**
 * Converters from other platforms' tabbed code into Quill's canonical code
 * group (ADR-041), for the importer (quill-plan.md M4). Pure string to string,
 * so the importer can run them over a file before parsing it.
 *
 * These syntaxes are imported, never read live:
 *
 * - **Material for MkDocs** (`pymdownx.tabbed`): `=== "Label"` followed by
 *   indented content. CommonMark reads that as a paragraph and an indented
 *   code block, so reading it live would mean changing how core syntax
 *   parses, which ADR-039 forbids.
 * - **GitBook**: `{% tabs %}{% tab title="…" %}…{% endtab %}{% endtabs %}`,
 *   template tags rather than Markdown.
 * - **MDX components**: Docusaurus's and Starlight's `<Tabs>`/`<TabItem>`,
 *   and Mintlify's `<CodeGroup>`. JSX is not Markdown (ADR-032).
 *
 * Only tabs whose every panel is exactly one fenced code block are converted,
 * because that is what a code group is; tabs of prose are left exactly as
 * written for the importer to report. Anything inside a fenced block — a page
 * documenting one of these syntaxes — is never touched.
 */

interface Fence {
  readonly marker: string
  readonly language: string
  readonly meta: string
  readonly body: string
}

interface Tab {
  readonly label: string
  readonly content: string
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/u

/** A panel's content as one fenced block, or undefined when it is anything else. */
function soleFence(content: string): Fence | undefined {
  const lines = dedent(content.split('\n'))
  while (lines[0]?.trim() === '') lines.shift()
  while (lines.at(-1)?.trim() === '') lines.pop()
  const open = FENCE_OPEN.exec(lines[0] ?? '')
  const last = lines.at(-1)?.trim() ?? ''
  if (open === null || lines.length < 2) return undefined
  const [, marker = '', info = ''] = open
  if (!closes(last, marker)) return undefined
  const inner = lines.slice(1, -1)
  if (inner.some((line) => closes(line, marker))) return undefined
  const [language = '', ...meta] = info.trim().split(/\s+/u)
  return { marker, language, meta: meta.join(' '), body: inner.join('\n') }
}

/** Whether a line closes a fence opened with `marker`: the same character, at least as many. */
function closes(line: string, marker: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith(marker) && trimmed.replaceAll(marker.charAt(0), '') === ''
}

export function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

export function dedent(lines: readonly string[]): string[] {
  const depth = Math.min(
    ...lines.filter((line) => line.trim() !== '').map((line) => indentOf(line)),
  )
  return lines.map((line) => line.slice(Number.isFinite(depth) ? depth : 0))
}

/** A label that cannot close the brackets it is written in. */
function cleanLabel(label: string): string {
  return label.replaceAll(/[[\]\n]/gu, '').trim()
}

/** A platform's group id as a sync key, if anything of it survives the key's shape. */
function syncKey(id: string | undefined): string | undefined {
  if (id === undefined) return undefined
  const key = id
    .trim()
    .replaceAll(/[^\w-]+/gu, '-')
    .replace(/^[-_]+/u, '')
    .slice(0, 32)
  return SYNC_KEY.test(key) ? key : undefined
}

/** The canonical group for these tabs, or undefined unless every panel is one fence. */
function codeGroup(tabs: readonly Tab[], sync?: string): string | undefined {
  const fences = tabs.map((tab) => ({
    label: cleanLabel(tab.label),
    fence: soleFence(tab.content),
  }))
  if (fences.length === 0) return undefined
  const written: string[] = []
  for (const { label, fence } of fences) {
    if (fence === undefined) return undefined
    const language = fence.language === '' ? 'text' : fence.language
    const meta = [language, label === '' ? '' : `[${label}]`, fence.meta].filter(
      (part) => part !== '',
    )
    written.push(
      `${fence.marker}${meta.join(' ')}`,
      ...(fence.body === '' ? [] : [fence.body]),
      fence.marker,
    )
  }
  const key = syncKey(sync)
  return [`:::code-group${key === undefined ? '' : `{sync=${key}}`}`, ...written, ':::'].join('\n')
}

/**
 * Splits a document into the lines outside fenced code and the fenced runs,
 * so a converter rewrites only what is Markdown structure.
 */
function outsideFences(lines: readonly string[]): readonly boolean[] {
  let open: string | undefined
  return lines.map((line) => {
    // CommonMark's fences are indented by three spaces at most; four is code.
    const fence = indentOf(line) > 3 ? undefined : FENCE_OPEN.exec(line)?.[1]
    if (open === undefined) {
      if (fence !== undefined) open = fence
      return fence === undefined
    }
    if (fence !== undefined && closes(line, open)) open = undefined
    return false
  })
}

/** The first of some lines, or nothing: an opening line is tested without indexing. */
export function firstOf(lines: readonly string[]): string {
  return lines.slice(0, 1).join('')
}

/**
 * Rewrites each block from an opening line to its closing line — `find` is
 * given the lines from a candidate opening on, and answers how many lines on
 * the block ends — when `convert` turns it into a group; everything else is
 * kept as written.
 */
export function rewriteBlocks(
  markdown: string,
  find: (rest: readonly string[]) => number | undefined,
  convert: (block: readonly string[]) => string | undefined,
): string {
  const lines = markdown.split('\n')
  const outside = outsideFences(lines)
  const out: string[] = []
  let skipThrough = -1
  lines.forEach((line, index) => {
    if (index <= skipThrough) return
    const end = outside[index] === true ? find(lines.slice(index)) : undefined
    const group = end === undefined ? undefined : convert(lines.slice(index, index + end + 1))
    if (end === undefined || group === undefined) {
      out.push(line)
      return
    }
    out.push(group)
    skipThrough = index + end
  })
  return out.join('\n')
}

/* --- Material for MkDocs ------------------------------------------------- */

const MKDOCS_TAB = /^(\s*)===[!+]?\s+"([^"]*)"\s*$/u

function mkdocsEnd(rest: readonly string[]): number | undefined {
  const opening = MKDOCS_TAB.exec(firstOf(rest))
  if (opening === null) return undefined
  const [, indent = ''] = opening
  let end = 0
  for (const [index, line] of rest.entries()) {
    if (index === 0 || MKDOCS_TAB.exec(line)?.[1] === indent) {
      end = index
      continue
    }
    if (line.trim() === '') continue
    if (indentOf(line) < indent.length + 4) break
    end = index
  }
  return end
}

function mkdocsTabs(block: readonly string[]): string | undefined {
  const indent = firstOf(block).slice(0, indentOf(firstOf(block)))
  const tabs: { label: string; lines: string[] }[] = []
  for (const line of block) {
    const [, depth, label = ''] = MKDOCS_TAB.exec(line) ?? []
    if (depth === indent) tabs.push({ label, lines: [] })
    else tabs.at(-1)?.lines.push(line)
  }
  const group = codeGroup(tabs.map((tab) => ({ label: tab.label, content: tab.lines.join('\n') })))
  return group?.replaceAll(/^/gmu, indent)
}

/** Material for MkDocs content tabs (`=== "Label"`) of fenced code, as code groups. */
export function importMkDocsTabs(markdown: string): string {
  return rewriteBlocks(markdown, mkdocsEnd, mkdocsTabs)
}

/* --- GitBook ------------------------------------------------------------- */

const GITBOOK_OPEN = /^\s*\{%\s*tabs\s*%\}\s*$/u
const GITBOOK_CLOSE = /^\s*\{%\s*endtabs\s*%\}\s*$/u
const GITBOOK_TAB = /\{%\s*tab\s+title="([^"]*)"\s*%\}([\s\S]*?)\{%\s*endtab\s*%\}/gu

export function closingLine(open: RegExp, close: RegExp) {
  return (rest: readonly string[]): number | undefined => {
    if (!open.test(firstOf(rest))) return undefined
    const end = rest.findIndex((line) => close.test(line))
    return end === -1 ? undefined : end
  }
}

/** The tabs a pattern finds inside a block, provided nothing else is in there. */
function tabsOf(
  inside: string,
  pattern: RegExp,
  tab: (match: RegExpExecArray) => Tab,
): Tab[] | undefined {
  if (inside.replaceAll(pattern, '').trim() !== '') return undefined
  return [...inside.matchAll(pattern)].map((match) => tab(match))
}

function gitbookTabs(block: readonly string[]): string | undefined {
  const tabs = tabsOf(
    block.slice(1, -1).join('\n'),
    GITBOOK_TAB,
    ([, label = '', content = '']) => ({ label, content }),
  )
  return tabs === undefined ? undefined : codeGroup(tabs)
}

/** GitBook's `{% tabs %}` of fenced code, as code groups. */
export function importGitBookTabs(markdown: string): string {
  return rewriteBlocks(markdown, closingLine(GITBOOK_OPEN, GITBOOK_CLOSE), gitbookTabs)
}

/* --- MDX: Docusaurus, Starlight, Mintlify -------------------------------- */

const TABS_OPEN = /^\s*<Tabs(\s[^>]*)?>\s*$/u
const TABS_CLOSE = /^\s*<\/Tabs>\s*$/u
const TAB_ITEM = /<TabItem(\s[^>]*)?>([\s\S]*?)<\/TabItem>/gu
const CODE_GROUP_OPEN = /^\s*<CodeGroup(\s[^>]*)?>\s*$/u
const CODE_GROUP_CLOSE = /^\s*<\/CodeGroup>\s*$/u

/** One JSX attribute's string value: `name="value"`, `name='value'` or `name={"value"}`. */
export function jsxAttribute(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)'|\\{["']([^"']*)["']\\})`, 'u')
  const [, double, single, braced] = pattern.exec(attributes) ?? []
  return double ?? single ?? braced
}

function mdxTabs(block: readonly string[]): string | undefined {
  const head = firstOf(block)
  const tabs = tabsOf(
    block.slice(1, -1).join('\n'),
    TAB_ITEM,
    ([, attributes = '', content = '']) => ({
      label: jsxAttribute(attributes, 'label') ?? jsxAttribute(attributes, 'value') ?? '',
      content,
    }),
  )
  // Docusaurus calls the shared choice `groupId`, Starlight `syncKey`.
  const sync = jsxAttribute(head, 'groupId') ?? jsxAttribute(head, 'syncKey')
  return tabs === undefined ? undefined : codeGroup(tabs, sync)
}

/** A Mintlify fence, whose meta is its tab's name rather than anything else. */
function mintlifyTab(lines: readonly string[], marker: string): Tab {
  const info = firstOf(lines).trim().slice(marker.length)
  const [language = '', ...label] = info.trim().split(/\s+/u)
  return {
    label: label.join(' '),
    content: [`${marker}${language}`, ...lines.slice(1)].join('\n'),
  }
}

/** Mintlify's `<CodeGroup>`: nothing but fences, each named by its meta. */
function mintlifyGroup(block: readonly string[]): string | undefined {
  const tabs: Tab[] = []
  let current: string[] = []
  let marker = ''
  for (const line of dedent(block.slice(1, -1))) {
    if (current.length > 0) {
      current.push(line)
      if (closes(line, marker)) {
        tabs.push(mintlifyTab(current, marker))
        current = []
      }
      continue
    }
    if (line.trim() === '') continue
    const [, opened] = FENCE_OPEN.exec(line) ?? []
    if (opened === undefined) return undefined
    marker = opened
    current = [line]
  }
  return current.length === 0 ? codeGroup(tabs) : undefined
}

/**
 * MDX tab components of fenced code, as code groups: Docusaurus and
 * Starlight `<Tabs>`/`<TabItem>`, keeping `groupId` or `syncKey` as the
 * group's `sync`, and Mintlify's `<CodeGroup>`.
 */
export function importMdxTabs(markdown: string): string {
  const tabs = rewriteBlocks(markdown, closingLine(TABS_OPEN, TABS_CLOSE), mdxTabs)
  return rewriteBlocks(tabs, closingLine(CODE_GROUP_OPEN, CODE_GROUP_CLOSE), mintlifyGroup)
}

/** Every platform's tabbed code in a document, as Quill's code groups. */
export function importCodeGroups(markdown: string): string {
  return importMdxTabs(importGitBookTabs(importMkDocsTabs(markdown)))
}
