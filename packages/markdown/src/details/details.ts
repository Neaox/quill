import type { Paragraph, Parent, RootContent } from 'mdast'
import type { ContainerDirective } from 'mdast-util-directive'

import type { CalloutType } from '../directives/callout.ts'
import { isCalloutType } from '../directives/callout.ts'
import type {
  Directive,
  DirectiveAttributes,
  DirectiveContent,
  DirectiveIssue,
  DirectiveValidator,
} from '../directives/definition.ts'
import { attribute, bodyOf, claims, flag, issue } from '../directives/definition.ts'

/**
 * Details and accordions: a section a reader opens when they want it
 * (ADR-048).
 *
 * This module owns the construct on every stage, in the shape ADR-039 asks a
 * Markdown extension to take, as code groups do (ADR-041): how a details is
 * read (`read.ts`), written back (`write.ts`), drawn and sanitised
 * (`render.ts`) and checked (`detailsDirective`, `accordionDirective`); the
 * editor's schema models it as `details` and `detailsSummary`.
 *
 * Three syntaxes are read live, and each document keeps the one its author
 * wrote:
 *
 * - **The container directive**, Quill's own form and the one a details made
 *   in the editor is written in: `:::details[Summary]{open name=faq type=tip}`.
 *   It stays a `containerDirective` in the tree, so attribute spelling, fence
 *   lengths and every other directive tool apply to it unchanged.
 * - **GitHub's raw HTML**, `<details>` and `<summary>` with Markdown between
 *   them. Only that exact shape is read — the two tags, lower case, and the
 *   bare `open` attribute — and anything else stays raw HTML, escaped to text
 *   as all raw HTML is (ADR-011). It becomes a `details` node.
 * - **Obsidian's foldable callouts**, `> [!note]-` (closed) and `> [!note]+`
 *   (open). A foldable callout is a callout drawn as a details. It becomes a
 *   `details` node too.
 *
 * Whatever the syntax, a details is the same three things: an optional
 * summary, which is the first child when it is a paragraph marked as a
 * directive label, exactly as `:::name[Label]` keeps its label; a body of
 * blocks; and its attributes, read the same way in every syntax (`open`,
 * `name`, `type`). So everything downstream — rendering, the editor, search —
 * reads one model (`detailsModel`) and never asks which syntax it was.
 */

/** The syntaxes a `details` node is written in; the directive form is a `containerDirective`. */
export type DetailsSyntax = 'html' | 'callout'

/** How GitHub's HTML form was written, so a details nobody changed is written back byte for byte. */
export interface HtmlDetailsSource {
  readonly syntax: 'html'
  /** From `<details` to the end of `</summary>` (or of `<details>` without one), as written. */
  readonly opening: string
  /** What the opening reads as, compared as JSON: its `open` and its summary's content. */
  readonly read: string
  /** Blank lines between the opening and the body (or the closing tag, for an empty body). */
  readonly afterOpening: number
  /** Blank lines between the body and `</details>`. */
  readonly beforeClosing: number
}

/** How an Obsidian foldable callout was written. */
export interface CalloutDetailsSource {
  readonly syntax: 'callout'
  /** The marker as written, `[!NOTE]-`, and the attributes it reads as, compared as JSON. */
  readonly marker: string
  readonly read: string
  /** Whether the body's first paragraph ran on from the title's line, with no `>` line between. */
  readonly joined: boolean
}

export type DetailsSource = HtmlDetailsSource | CalloutDetailsSource

export interface Details extends Parent {
  type: 'details'
  syntax: DetailsSyntax
  /** `open`, `name` and `type`, as a directive's attributes are: the one vocabulary all three syntaxes share. */
  attributes: DirectiveAttributes
  /** How the node was written; absent from a node the editor made. */
  source?: DetailsSource | undefined
  /** The summary, as a directive label paragraph, then the body. */
  children: DirectiveContent
}

declare module 'mdast' {
  interface RootContentMap {
    details: Details
  }
  interface BlockContentMap {
    details: Details
  }
}

export const DETAILS = 'details'
export const ACCORDION = 'accordion'

/**
 * A name groups details so that opening one closes the others, which is the
 * browser's own exclusive accordion (`<details name>`). The shape a sync key
 * has (ADR-041), so it is safe as an attribute value anywhere.
 */
export const DETAILS_NAME = /^[A-Za-z0-9][\w-]{0,31}$/u

/** Any of the three syntaxes, as the tree holds it. */
export type DetailsNode = Details | ContainerDirective

export function isDetails(node: { readonly type: string }): node is Details {
  return node.type === 'details'
}

function isNamedContainer(
  node: { readonly type: string; readonly name?: unknown },
  name: string,
): boolean {
  return node.type === 'containerDirective' && node.name === name
}

/** A details in any syntax: a `details` node, or a `:::details` container directive. */
export function isDetailsNode(node: {
  readonly type: string
  readonly name?: unknown
}): node is DetailsNode {
  return isDetails(node) || isNamedContainer(node, DETAILS)
}

/**
 * Node types that only ever stand in a run of inline content or inside a
 * list or a table, never among a container's blocks.
 */
const NOT_FLOW: ReadonlySet<string> = new Set([
  'break',
  'delete',
  'emphasis',
  'footnoteReference',
  'image',
  'imageReference',
  'inlineCode',
  'link',
  'linkReference',
  'listItem',
  'strong',
  'tableCell',
  'tableRow',
  'text',
  'textDirective',
  'yaml',
])

/** Whether a node can be one of a container's blocks, a details' body included. */
export function isFlowContent(node: RootContent): node is DirectiveContent[number] {
  return !NOT_FLOW.has(node.type)
}

/**
 * Obsidian's callout kinds and their aliases, onto Quill's (ADR-036). A kind
 * neither knows is drawn as a note, the way an unknown `:::callout` type is.
 */
const CALLOUT_ALIASES: Readonly<Record<string, CalloutType>> = {
  abstract: 'note',
  summary: 'note',
  tldr: 'note',
  example: 'note',
  quote: 'note',
  cite: 'note',
  todo: 'info',
  question: 'info',
  help: 'info',
  faq: 'info',
  success: 'tip',
  check: 'tip',
  done: 'tip',
  hint: 'tip',
  attention: 'warning',
  failure: 'caution',
  fail: 'caution',
  missing: 'caution',
  danger: 'caution',
  error: 'caution',
  bug: 'caution',
}

/** The callout a kind is drawn as, or undefined when it is no kind Quill or Obsidian knows. */
export function knownCalloutKind(kind: string): CalloutType | undefined {
  const lower = kind.toLowerCase()
  return isCalloutType(lower) ? lower : CALLOUT_ALIASES[lower]
}

/** A details' attributes, whichever syntax it was written in. */
function attributesOf(node: DetailsNode): DirectiveAttributes {
  return node.attributes ?? {}
}

/**
 * The callout a details is drawn as: its `type`, mapped onto Quill's kinds,
 * or a note for a kind nobody knows; undefined when it has no type and is a
 * plain details.
 */
export function calloutKindOf(node: DetailsNode): CalloutType | undefined {
  const type = attributesOf(node)['type']
  if (type === undefined || type === null) return undefined
  return knownCalloutKind(type) ?? 'note'
}

/** The name grouping this details with others, when it is one a page can use. */
export function nameOf(node: DetailsNode): string | undefined {
  const name = attributesOf(node)['name']
  return typeof name === 'string' && DETAILS_NAME.test(name) ? name : undefined
}

export interface DetailsModel {
  /** The summary line: inline Markdown, as the label paragraph holds it. */
  readonly summary: Paragraph | undefined
  readonly body: DirectiveContent
  /** Whether a reader finds it open: the document's default, not anyone's last click. */
  readonly open: boolean
  readonly name: string | undefined
  readonly kind: CalloutType | undefined
}

function isSummary(node: DirectiveContent[number] | undefined): node is Paragraph {
  return node?.type === 'paragraph' && node.data?.directiveLabel === true
}

/** What a details says, the same for every syntax it can be written in. */
export function detailsModel(node: DetailsNode): DetailsModel {
  const [first] = node.children
  const summary = isSummary(first) && first.children.length > 0 ? first : undefined
  const body =
    node.type === 'details' ? node.children.filter((child) => !isSummary(child)) : bodyOf(node)
  return {
    summary,
    body,
    open: flag(node, 'open'),
    name: nameOf(node),
    kind: calloutKindOf(node),
  }
}

/* --- Checking ------------------------------------------------------------ */

/**
 * `:::details` is checked for what it can carry: a callout kind it can draw,
 * and a name a page can group by. Neither stops it rendering — an unknown
 * kind is a note, and a name in the wrong shape groups nothing — so both are
 * warnings (ADR-002).
 */
export const detailsDirective: DirectiveValidator = {
  names: [DETAILS],
  kinds: ['container'],
  validate(node: Directive): readonly DirectiveIssue[] {
    if (!claims(detailsDirective, node)) return []
    const type = attribute(node, 'type')
    const name = attribute(node, 'name')
    return [
      ...(type === undefined || knownCalloutKind(type) !== undefined
        ? []
        : [issue('type', `Unknown callout type "${type}"; rendered as note.`, 'warning')]),
      ...(name === undefined || DETAILS_NAME.test(name)
        ? []
        : [
            issue(
              'name',
              `"${name}" cannot group details: use letters, digits, - and _ only, up to 32 of them.`,
              'warning',
            ),
          ]),
    ]
  },
}

/**
 * `:::accordion` groups the details it holds, so opening one closes the
 * others. Anything else in it is shown as it is, and said so.
 */
export const accordionDirective: DirectiveValidator = {
  names: [ACCORDION],
  kinds: ['container'],
  validate(node: Directive): readonly DirectiveIssue[] {
    if (node.type !== 'containerDirective' || !claims(accordionDirective, node)) return []
    if (bodyOf(node).every((child) => isDetailsNode(child))) return []
    return [issue('', 'An accordion holds details; anything else in it shows as it is.', 'warning')]
  },
}
