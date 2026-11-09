import { toString } from 'mdast-util-to-string'
import type { Element, ElementContent, Properties } from 'hast'
import type { Paragraph, Parents } from 'mdast'
import type { ContainerDirective, LeafDirective, TextDirective } from 'mdast-util-directive'

import type { Directive } from '../directives/definition.ts'
import { bodyOf } from '../directives/definition.ts'
import { attributeSource, directiveSource } from '../render/directive-source.ts'
import type { State } from '../render/hast-state.ts'
import type { AnyBlock } from './define.ts'
import { blockKind, itemsOf, takesBody } from './define.ts'
import type { PropIssue } from './props.ts'
import { readProps } from './props.ts'
import type { BlockRegistry } from './registry.ts'

/**
 * How a component block reaches the page (ADR-060), and what a reader sees
 * when it cannot.
 *
 * A registered block is drawn by its own `render`, from props read against
 * its schema and content the pipeline has already rendered; the root it
 * returns is stamped `qb qb-<name>`, which is how the stylesheet and the
 * sanitiser recognise it. Nothing a block writes is trusted more than
 * anything else on the page: the document sanitiser runs after it, with a
 * grant that admits only `qb-` classes, an accessible name, and the data
 * attributes registered blocks declare (`blockSanitizeSchema`).
 *
 * Nothing a block holds is ever dropped without a word, on the page or in
 * the document's health (ADR-002's degradation rule, made visible):
 *
 * - **An unknown container** (`:::timeline` with no block of that name) is
 *   drawn as a labelled frame naming it, its content inside as Markdown, so
 *   a page written for blocks this instance does not have stays legible.
 * - **A prop that does not fit** is drawn as its default, or left out, and
 *   the block says so in a note above its content.
 * - **A block that cannot be drawn** — a required prop missing, a `[label]`
 *   it needs, the wrong form, outside the block it belongs in, a render that
 *   throws — is drawn as the same frame as an unknown one, with the reason.
 *
 * Every one of these is also recorded as a `BlockIssue`, which the document's
 * health reports beside its broken links.
 */

/** A problem with a block in a document, as the document's health reports it. */
export interface BlockIssue {
  /** The directive name as written. */
  readonly block: string
  readonly message: string
  /** The line the directive starts on, when the tree still knows. */
  readonly line?: number | undefined
}

export interface BlockRendererOptions {
  readonly registry: BlockRegistry
  /** Where the issues found while rendering are collected, in document order. */
  readonly issues: BlockIssue[]
}

/**
 * What the frame and the notes above need from the document sanitiser: the
 * frame is a group named in words, and the notes are text.
 */
export const BLOCK_FRAME_SANITIZE_GRANT = {
  classes: {
    div: ['block-fallback'],
    p: ['block-fallback-head', 'block-issues'],
    span: ['block-fallback-reason', 'block-issues', 'block-issues-label'],
  },
} as const

/** Elements whose children a note cannot go among: the note is put before them instead. */
const LIST_ROOTS: ReadonlySet<string> = new Set(['ol', 'ul', 'dl', 'table', 'tbody', 'tr', 'menu'])

function element(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: 'element', tagName, properties, children }
}

function text(value: string): ElementContent {
  return { type: 'text', value }
}

function isLabelParagraph(node: ContainerDirective['children'][number]): node is Paragraph {
  return node.type === 'paragraph' && node.data?.directiveLabel === true
}

function nameOfParent(parent: Parents | undefined): string | undefined {
  return parent?.type === 'containerDirective' ? parent.name : undefined
}

function sentence(messages: readonly string[]): string {
  return `${messages.join('. ')}.`
}

const FORM: Readonly<Record<ReturnType<typeof blockKind>, (name: string) => string>> = {
  container: (name) => `:::${name}`,
  leaf: (name) => `::${name}`,
  text: (name) => `:${name}[…]`,
}

/** A text directive with no label and no attributes is prose that happens to hold a colon. */
function isProse(node: TextDirective): boolean {
  return node.children.length === 0 && Object.keys(node.attributes ?? {}).length === 0
}

export interface BlockRenderer {
  /** A registered container block, or undefined when the name is no block's. */
  container(
    state: State,
    node: ContainerDirective,
    parent: Parents | undefined,
  ): ElementContent | ElementContent[] | undefined
  leaf(
    state: State,
    node: LeafDirective,
    parent: Parents | undefined,
  ): ElementContent | ElementContent[] | undefined
  text(
    state: State,
    node: TextDirective,
    parent: Parents | undefined,
  ): ElementContent | ElementContent[] | undefined
  /** A container no block or directive claims: the labelled frame, with its content. */
  unknownContainer(state: State, node: ContainerDirective): Element
  /** Records a leaf or text directive nothing claims; prose that holds a colon is not one. */
  unknown(node: LeafDirective | TextDirective): void
}

export function createBlockRenderer(options: BlockRendererOptions): BlockRenderer {
  const { registry, issues } = options

  const report = (node: Directive, message: string): void => {
    const line = node.position?.start.line
    issues.push({ block: node.name, message, ...(line === undefined ? {} : { line }) })
  }

  /** The frame an unknown block, or one that cannot be drawn, is shown in. */
  const frame = (state: State, node: Directive, reason: string, body: ElementContent[]): Element =>
    element(
      'div',
      { className: ['block-fallback'], role: 'group', 'aria-label': `${reason}: ${node.name}` },
      state.wrap(
        [
          element('p', { className: ['block-fallback-head'] }, [
            element('code', {}, [text(`${node.name}${attributeSource(node.attributes)}`)]),
            text(' '),
            element('span', { className: ['block-fallback-reason'] }, [text(reason)]),
          ]),
          ...body,
        ],
        true,
      ),
    )

  const inlineNote = (messages: readonly string[]): Element =>
    element('span', { className: ['block-issues'] }, [text(` (${sentence(messages)})`)])

  const blockNote = (messages: readonly string[]): Element =>
    element('p', { className: ['block-issues'] }, [
      element('span', { className: ['block-issues-label'] }, [text('Check this block')]),
      text(` ${sentence(messages)}`),
    ])

  /** What a directive that is not drawn as its block shows instead, by form. */
  const notDrawn = (
    state: State,
    node: Directive,
    reason: string,
  ): ElementContent | ElementContent[] => {
    switch (node.type) {
      case 'containerDirective':
        return frame(state, node, reason, state.all(node))
      case 'leafDirective':
        return frame(state, node, reason, [element('p', {}, directiveSource(state, node, '::'))])
      case 'textDirective':
        return [...directiveSource(state, node, ':'), inlineNote([reason])]
    }
  }

  /** The root a block returned, stamped as its block and carrying its notes. */
  const placed = (
    block: AnyBlock,
    root: Element,
    notes: readonly string[],
    before: readonly ElementContent[],
  ): ElementContent | ElementContent[] => {
    const { className: existing, ...properties } = root.properties
    const classes = Array.isArray(existing) ? existing.map(String) : []
    const stamped: Element = {
      ...root,
      properties: { className: ['qb', `qb-${block.name}`, ...classes], ...properties },
    }
    if (notes.length === 0) return stamped
    if (blockKind(block) === 'text') return [stamped, inlineNote(notes)]
    if (before.length > 0 || LIST_ROOTS.has(root.tagName)) {
      return [blockNote(notes), ...before, stamped]
    }
    return { ...stamped, children: [blockNote(notes), ...stamped.children] }
  }

  /** Why a block found by name cannot be drawn here at all, or undefined when it can. */
  const fatal = (
    block: AnyBlock,
    node: Directive,
    parent: Parents | undefined,
    propIssues: readonly PropIssue[],
  ): string | undefined => {
    const within = block.within
    const parentName = nameOfParent(parent)
    if (within !== undefined && (parentName === undefined || !within.includes(parentName))) {
      return `${block.name} belongs inside ${within.join(' or ')}`
    }
    const missing = propIssues.find((each) => each.fatal)
    if (missing !== undefined) return missing.message
    if (block.label === 'required' && labelWords(node) === '') {
      return `${block.name} needs a [label]`
    }
    return undefined
  }

  const labelWords = (node: Directive): string => {
    if (node.type === 'textDirective') return ''
    if (node.type === 'leafDirective') return toString(node).trim()
    const [first] = node.children
    return first !== undefined && isLabelParagraph(first) ? toString(first).trim() : ''
  }

  const draw = (
    state: State,
    block: AnyBlock,
    node: Directive,
    parent: Parents | undefined,
  ): ElementContent | ElementContent[] => {
    const props = readProps(block.props, node.attributes)
    const reason = fatal(block, node, parent, props.issues)
    if (reason !== undefined) {
      report(node, reason)
      return notDrawn(state, node, reason)
    }

    const notes = props.issues.map((each) => each.message)
    const takesLabel = (block.label ?? 'none') !== 'none'
    const words = labelWords(node)
    if (!takesLabel && words !== '') notes.push(`${block.name} takes no [label]; it is not shown`)

    let label: ElementContent[] = []
    let content: ElementContent[] = []
    let items: ElementContent[] = []
    // Markdown an `items` block does not take: drawn before it, never dropped.
    let before: ElementContent[] = []
    if (node.type === 'textDirective') {
      content = state.all(node)
    } else if (node.type === 'leafDirective') {
      label = takesLabel ? state.all(node) : []
    } else {
      const [first] = node.children
      label = takesLabel && first !== undefined && isLabelParagraph(first) ? state.all(first) : []
      const itemName = itemsOf(block)
      const body = bodyOf(node)
      const isItem = (child: (typeof body)[number]): boolean =>
        child.type === 'containerDirective' && child.name === itemName
      const rest = itemName === undefined ? body : body.filter((child) => !isItem(child))
      const drawn = rest.length === 0 ? [] : state.all({ ...node, children: rest })
      if (itemName !== undefined) {
        items = state.all({ ...node, children: body.filter(isItem) })
      }
      if (itemName !== undefined && rest.length > 0 && !takesBody(block)) {
        notes.push(`${block.name} holds only ${itemName} blocks; the rest is shown first`)
        before = drawn
      } else {
        content = drawn.length === 0 ? [] : state.wrap(drawn, true)
      }
    }

    let root: Element
    try {
      root = block.render({ props: props.values, label, labelText: words, content, items })
    } catch {
      const failed = `${block.name} could not be drawn`
      report(node, failed)
      return notDrawn(state, node, failed)
    }
    for (const note of notes) report(node, note)
    return placed(block, root, notes, before)
  }

  /** A directive with a block's name written in the wrong form: drawn as written, and said. */
  const misformed = (
    state: State,
    node: Directive,
  ): ElementContent | ElementContent[] | undefined => {
    const block = registry.named(node.name)
    if (block === undefined) return undefined
    const reason = `${block.name} is written ${FORM[blockKind(block)](block.name)}`
    report(node, reason)
    return notDrawn(state, node, reason)
  }

  return {
    container: (state, node, parent) => {
      const block = registry.find(node.name, 'container')
      return block === undefined ? misformed(state, node) : draw(state, block, node, parent)
    },
    leaf: (state, node, parent) => {
      const block = registry.find(node.name, 'leaf')
      return block === undefined ? misformed(state, node) : draw(state, block, node, parent)
    },
    text: (state, node, parent) => {
      const block = registry.find(node.name, 'text')
      if (block !== undefined) return draw(state, block, node, parent)
      return isProse(node) ? undefined : misformed(state, node)
    },
    unknownContainer: (state, node) => {
      report(node, `no block is called ${node.name}`)
      return frame(state, node, 'Unknown block', state.all(node))
    },
    unknown: (node) => {
      if (node.type === 'textDirective' && isProse(node)) return
      report(node, `no block is called ${node.name}`)
    },
  }
}
