import type { Code, Parent, Root, RootContent } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'
import { directiveToMarkdown } from 'mdast-util-directive'

import type {
  DirectiveAttributes,
  DirectiveIssue,
  DirectiveValidator,
} from '../directives/definition.ts'
import { claims, issue } from '../directives/definition.ts'
import type { ToMarkdownExtension } from '../pipeline/raw-mdast.ts'
import { fenceTitle, hasTabAttribute, tabLabel } from './fence-meta.ts'
import { languageLabel } from './languages.ts'

/**
 * Code groups: several fenced blocks shown as one card with a tab per block,
 * "the same example in TypeScript, Python and curl" (ADR-041).
 *
 * This module owns the construct on every stage, in the shape ADR-039 asks a
 * Markdown extension to take, so it can move behind `MarkdownExtension`
 * unchanged: how a group is read (`groupCodeBlocks`), written back
 * (`codeGroupToMarkdown`), named (`codeGroupTabs`) and checked
 * (`codeGroupDirective`); `render.ts` beside it draws it and lists its
 * sanitiser grant, and the editor's schema models it as `codeGroup`.
 *
 * Three syntaxes are read live, and each document keeps the one its author
 * wrote:
 *
 * - `directive`: VitePress's `:::code-group`, which is also Quill's own
 *   container-directive syntax (ADR-002), and the form a group made in the
 *   editor is written in;
 * - `spaced`: `::: code-group`, as VitePress's documentation writes it. The
 *   space makes it no directive at all — CommonMark reads a paragraph, the
 *   fences, and a paragraph of `:::` — so it is recognised in the tree, which
 *   changes nothing about how any core syntax parses (ADR-039);
 * - `tabs`: Fumadocs's consecutive fences carrying `tab="…"`, with no wrapper,
 *   which reads everywhere else as exactly the fences it is.
 *
 * Every member's label is in its own fence meta (`fence-meta.ts`), so outside
 * Quill a group reads as consecutive code blocks.
 */

export type CodeGroupSyntax = 'directive' | 'spaced' | 'tabs'

export interface CodeGroup extends Parent {
  type: 'codeGroup'
  syntax: CodeGroupSyntax
  /** The directive's attributes; only `sync` means anything (`syncKeyOf`). */
  attributes: DirectiveAttributes
  /** Whether the source separates its lines with blank lines, which it is written back with. */
  spread: boolean
  /** The opening line as written, kept so a group nobody changed is written back byte for byte. */
  opening?: string | undefined
  children: Code[]
}

declare module 'mdast-util-directive' {
  interface ContainerDirectiveData {
    /** Set only on the stand-in `codeGroupToMarkdown` counts a group's colons with. */
    codeGroup?: CodeGroup | undefined
  }
}

declare module 'mdast' {
  interface RootContentMap {
    codeGroup: CodeGroup
  }
  interface BlockContentMap {
    codeGroup: CodeGroup
  }
}

export const CODE_GROUP = 'code-group'

/** A sync key: the set of groups a tab choice is shared across, like Docusaurus's `groupId`. */
export const SYNC_KEY = /^[A-Za-z0-9][\w-]{0,31}$/u

const SPACED_OPENING = /^:{3,}[ \t]+code-group[ \t]*$/u
const CLOSING = /^:{3,}$/u

export function isCodeGroup(node: { readonly type: string }): node is CodeGroup {
  return node.type === 'codeGroup'
}

/** A new group in the canonical form: a tight VitePress `:::code-group` (ADR-041). */
export function createCodeGroup(
  children: readonly Code[],
  attributes: DirectiveAttributes = {},
): CodeGroup {
  return {
    type: 'codeGroup',
    syntax: 'directive',
    attributes,
    spread: false,
    children: [...children],
  }
}

/** The group's sync key, if it names a valid one; otherwise it syncs by label across the page. */
export function syncKeyOf(group: CodeGroup): string | undefined {
  const key = group.attributes['sync']
  return typeof key === 'string' && SYNC_KEY.test(key) ? key : undefined
}

function nonEmpty(value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value.length === 0 ? undefined : value
}

/**
 * A tab's name: its label, else its file's title, else its language's name,
 * else the fence tag as written, else its place in the group.
 */
export function codeLabel(code: Code, index: number): string {
  return (
    tabLabel(code.meta) ??
    fenceTitle(code.meta) ??
    languageLabel(code.lang) ??
    nonEmpty(code.lang) ??
    `Code ${index + 1}`
  )
}

export interface CodeTab {
  readonly label: string
  /** The file the code belongs in, unless that is already the tab's name. */
  readonly title: string | undefined
  readonly code: Code
}

export function codeGroupTabs(group: CodeGroup): readonly CodeTab[] {
  return group.children.map((code, index) => {
    const label = codeLabel(code, index)
    const title = fenceTitle(code.meta)
    return { label, title: title === label ? undefined : title, code }
  })
}

/* --- Reading ------------------------------------------------------------- */

/** The lines a node starts and ends on, where the parser recorded them. */
interface Lines {
  readonly start: number
  readonly end: number
}

function linesOf(node: RootContent): Lines | undefined {
  const position = node.position
  return position === undefined ? undefined : { start: position.start.line, end: position.end.line }
}

/** Whether any two neighbouring parts are separated by a blank line. */
function spreadOf(parts: readonly (Lines | undefined)[]): boolean {
  return parts.some((part, index) => {
    const next = parts[index + 1]
    return part !== undefined && next !== undefined && next.start - part.end > 1
  })
}

function soleText(node: RootContent | undefined): string | undefined {
  if (node?.type !== 'paragraph') return undefined
  const [only] = node.children
  return node.children.length === 1 && only?.type === 'text' ? only.value : undefined
}

function isCode(node: RootContent): node is Code {
  return node.type === 'code'
}

function fromDirective(node: ContainerDirective, lines: readonly string[]): CodeGroup | undefined {
  if (node.name !== CODE_GROUP || node.children.length === 0) return undefined
  const codes = node.children.filter((child) => isCode(child))
  if (codes.length !== node.children.length) return undefined
  const whole = linesOf(node)
  // From the directive's own column: in a list item or a quote, the line also
  // holds the indent or the `>` the container writes for itself.
  const start = node.position?.start
  const opening =
    start === undefined
      ? undefined
      : lines
          .slice(start.line - 1, start.line)
          .join('')
          .slice(start.column - 1)
  return {
    type: 'codeGroup',
    syntax: 'directive',
    attributes: node.attributes ?? {},
    spread: spreadOf([
      whole && { start: whole.start, end: whole.start },
      ...codes.map((code) => linesOf(code)),
      whole && { start: whole.end, end: whole.end },
    ]),
    opening,
    children: codes,
  }
}

/** The fences of a spaced `::: code-group` starting at `index`, and the `:::` closing them. */
function spacedGroup(children: readonly RootContent[], index: number): CodeGroup | undefined {
  const opener = children[index]
  const opening = soleText(opener)
  if (opener === undefined || opening === undefined || !SPACED_OPENING.test(opening)) {
    return undefined
  }
  const rest = children.slice(index + 1)
  const end = rest.findIndex((next) => !isCode(next))
  const codes = rest.slice(0, Math.max(end, 0)).filter((next) => isCode(next))
  const closing = rest[end]
  const closer = soleText(closing)
  if (codes.length === 0 || closing === undefined || closer === undefined) return undefined
  if (!CLOSING.test(closer)) return undefined
  return {
    type: 'codeGroup',
    syntax: 'spaced',
    attributes: {},
    spread: spreadOf([opener, ...codes, closing].map((part) => linesOf(part))),
    opening,
    children: codes,
  }
}

/** A run of Fumadocs tabs starting at `index`: consecutive fences carrying `tab="…"`. */
function tabRun(children: readonly RootContent[], index: number): CodeGroup | undefined {
  const run: Code[] = []
  for (const next of children.slice(index)) {
    if (!isCode(next) || !hasTabAttribute(next.meta)) break
    run.push(next)
  }
  if (run.length === 0) return undefined
  return {
    type: 'codeGroup',
    syntax: 'tabs',
    attributes: {},
    spread: spreadOf(run.map((code) => linesOf(code))),
    children: run,
  }
}

/** How many siblings a group read at a position took up. */
function width(group: CodeGroup): number {
  if (group.syntax === 'spaced') return group.children.length + 2
  if (group.syntax === 'tabs') return group.children.length
  return 1
}

/** Groups the code in one list of siblings, and in everything they hold. */
function groupSiblings(children: readonly RootContent[], lines: readonly string[]): RootContent[] {
  const out: RootContent[] = []
  let skipThrough = -1
  children.forEach((child, index) => {
    if (index <= skipThrough) return
    const group =
      (child.type === 'containerDirective' ? fromDirective(child, lines) : undefined) ??
      spacedGroup(children, index) ??
      tabRun(children, index)
    if (group === undefined) {
      out.push(withGroups(child, lines))
      return
    }
    out.push(group)
    skipThrough = index + width(group) - 1
  })
  return out
}

function withGroups(node: RootContent, lines: readonly string[]): RootContent {
  if (!('children' in node)) return node
  const children: readonly RootContent[] = node.children
  if (!children.some((child) => 'children' in child || isCode(child))) return node
  return Object.assign({}, node, { children: groupSiblings(children, lines) })
}

/**
 * Finds every code group in a freshly parsed tree, wherever it sits — at the
 * top, in a callout, in a list item — and makes each one `codeGroup` node.
 * `source` is the normalised Markdown the tree was parsed from, which is
 * where a group's opening line is read as written.
 */
export function groupCodeBlocks(tree: Root, source: string): Root {
  return { ...tree, children: groupSiblings(tree.children, source.split('\n')) }
}

/* --- Writing ------------------------------------------------------------- */

const BARE_VALUE = /^[\w.-]+$/u

function writtenAttributes(attributes: DirectiveAttributes): string {
  const written = Object.entries(attributes).map(([name, value]) => {
    if (value === null || value === undefined || value === '') return name
    const safe = value.replaceAll(/["}\n]/gu, '')
    return BARE_VALUE.test(safe) ? `${name}=${safe}` : `${name}="${safe}"`
  })
  return written.length === 0 ? '' : `{${written.join(' ')}}`
}

function openingOf(group: CodeGroup): string | undefined {
  if (group.syntax === 'tabs') return undefined
  if (group.opening !== undefined) return group.opening
  return group.syntax === 'spaced'
    ? '::: code-group'
    : `:::code-group${writtenAttributes(group.attributes)}`
}

type Handle = NonNullable<NonNullable<ToMarkdownExtension['handlers']>['code']>

const writeGroup: Handle = (node: CodeGroup, _parent, state, info) => {
  const separator = node.spread ? '\n\n' : '\n'
  const members = node.children.map((code) =>
    state.handle(code, node, state, { ...info, before: '\n', after: '\n' }),
  )
  const opening = openingOf(node)
  if (opening === undefined) return members.join(separator)
  const closing = opening.slice(0, opening.search(/[^:]/u))
  return [opening, ...members, closing].join(separator)
}

const writeDirective = directiveToMarkdown().handlers?.containerDirective

/**
 * A container directive's descendants with every colon-fenced group replaced
 * by a stand-in container directive holding it.
 *
 * `mdast-util-directive` gives a container one more colon than the deepest
 * container inside it, so that its own `:::` does not close an inner one
 * early, and it counts only `containerDirective` nodes. A callout holding a
 * `:::code-group` would otherwise be written with the same three colons as
 * the group, and read back closed at the group's end. The stand-in is what
 * it counts; it is written as the group it holds.
 */
function withStandIns<Node extends RootContent>(node: Node): Node {
  if (!('children' in node)) return node
  const children: readonly RootContent[] = node.children
  return Object.assign({}, node, {
    children: children.map((child): RootContent =>
      isCodeGroup(child) && child.syntax !== 'tabs'
        ? {
            type: 'containerDirective',
            name: CODE_GROUP,
            attributes: {},
            children: [],
            data: { codeGroup: child },
          }
        : withStandIns(child),
    ),
  })
}

/**
 * Writes a group back in the syntax, spacing and opening line it was read
 * with, and keeps the container directives around it counting its colons.
 */
export const codeGroupToMarkdown: ToMarkdownExtension = {
  handlers: {
    codeGroup: writeGroup,
    containerDirective(node: ContainerDirective, parent, state, info) {
      const group = node.data?.codeGroup
      if (group !== undefined) return writeGroup(group, parent, state, info)
      /* v8 ignore next -- `mdast-util-directive` always defines its container handler. */
      if (writeDirective === undefined) return ''
      return writeDirective(withStandIns(node), parent, state, info)
    },
  },
}

/* --- Checking ------------------------------------------------------------ */

/**
 * A `:::code-group` that did not become a group — it holds prose, or a
 * `[Label]` — renders as its children, the way every unknown directive
 * degrades (ADR-002); this says why it did not become tabs.
 */
export const codeGroupDirective: DirectiveValidator = {
  names: [CODE_GROUP],
  kinds: ['container'],
  validate(node): readonly DirectiveIssue[] {
    if (!claims(codeGroupDirective, node)) return []
    return [
      issue(
        '',
        'A code group holds fenced code blocks and nothing else, so these show as separate blocks.',
        'warning',
      ),
    ]
  },
}
