import { childDepth, tocLevels } from '@quill/markdown'
import { NestedList } from '@quill/ui'
import type { Extensions, NodeConfig } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditorState,
} from '@tiptap/react'
import type { Editor, NodeViewProps } from '@tiptap/react'
import { tv } from 'tailwind-variants'

import { directiveAttributes, directiveName } from '../schema/directive-attributes.ts'
import {
  DEPTH_CHOICES,
  TOC_LEVEL_CHOICES,
  depthLabel,
  levelLabel,
  withDepth,
  withTocMax,
  withTocMin,
} from './block-controls.ts'
import { useChildDocuments } from './child-documents-context.tsx'
import { documentHeadings, headingItems, sameHeadings } from './document-headings.ts'
import { LevelSelect } from './level-select.tsx'

/**
 * How a leaf directive is drawn in the writing surface.
 *
 * Two of them are blocks with something to show and a setting to change: `::toc`
 * lists the document's own headings, and `::children` the documents beneath it.
 * Each is drawn the way it will read — the same list, between the same levels —
 * with its settings on the block itself, so changing how deep it goes is one
 * select away and the result is on screen at once. Every other leaf directive
 * stays what it was: a line of editable text, because an unknown directive must
 * survive a round trip untouched (AGENTS.md rule 7).
 *
 * The blocks are TipTap React node views, which is how they reach the editor
 * state (live headings) and the application's context (the child documents)
 * without the editor package learning anything about either.
 */

const block = tv({
  slots: {
    root: 'directive-block',
    header: 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-2',
    title: 'meta',
    settings: 'flex flex-wrap items-center gap-x-3 gap-y-1',
    empty: 'text-sm text-muted',
    entry: [
      'cursor-pointer text-start text-foreground underline decoration-border-strong underline-offset-2',
      'hover:text-accent hover:decoration-accent',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
  },
})
const styles = block()

/** Takes the caret to a heading, which is what choosing an entry of the contents does. */
function goToHeading(editor: Editor, id: string): void {
  const { view } = editor
  const inside = view.state.doc.resolve(Number(id) + 1)
  view.dispatch(view.state.tr.setSelection(TextSelection.near(inside)).scrollIntoView())
  view.focus()
}

const LEVEL_OPTIONS = TOC_LEVEL_CHOICES.map((value) => ({ value, label: levelLabel(value) }))
const DEPTH_OPTIONS = DEPTH_CHOICES.map((value) => ({ value, label: depthLabel(value) }))

function TableOfContentsBlock({ node, editor, updateAttributes }: NodeViewProps) {
  const attributes = directiveAttributes(node)
  const { min, max } = tocLevels(attributes)
  const headings = useEditorState({
    editor,
    selector: ({ editor: current }) => documentHeadings(current.state.doc),
    equalityFn: sameHeadings,
  })
  const entries = headingItems(headings, min, max)

  return (
    <NodeViewWrapper as="nav" className="toc" aria-label="Table of contents" data-directive="toc">
      <div className={styles.header()} contentEditable={false}>
        <p className={styles.title()}>Table of contents</p>
        <div className={styles.settings()}>
          <LevelSelect
            label="From"
            value={min}
            options={LEVEL_OPTIONS}
            onChange={(level) => {
              updateAttributes({ attributes: withTocMin(attributes, level) })
            }}
          />
          <LevelSelect
            label="To"
            value={max}
            options={LEVEL_OPTIONS}
            onChange={(level) => {
              updateAttributes({ attributes: withTocMax(attributes, level) })
            }}
          />
        </div>
      </div>
      <div contentEditable={false}>
        {entries.length === 0 ? (
          <p className={styles.empty()}>
            No headings from {levelLabel(min)} to {levelLabel(max)} yet. They will be listed here as
            you write them.
          </p>
        ) : (
          <NestedList
            items={entries}
            renderLabel={(item) => (
              <button
                type="button"
                className={styles.entry()}
                onClick={() => {
                  goToHeading(editor, item.id)
                }}
              >
                {item.label}
              </button>
            )}
          />
        )}
      </div>
    </NodeViewWrapper>
  )
}

function ChildDocumentsBlock({ node, updateAttributes }: NodeViewProps) {
  const attributes = directiveAttributes(node)
  const depth = childDepth(attributes)
  const children = useChildDocuments() ?? []

  return (
    <NodeViewWrapper
      as="section"
      className="live-block"
      aria-label="Child documents"
      data-live-block="children"
    >
      <div className={styles.header()} contentEditable={false}>
        <p className={styles.title()}>Child documents</p>
        <div className={styles.settings()}>
          <LevelSelect
            label="Show"
            value={depth}
            options={DEPTH_OPTIONS}
            onChange={(chosen) => {
              updateAttributes({ attributes: withDepth(attributes, chosen) })
            }}
          />
        </div>
      </div>
      <div contentEditable={false}>
        {children.length === 0 ? (
          <p className={styles.empty()}>
            This document has no child documents yet. Those you add beneath it will be listed here.
          </p>
        ) : (
          // The list is a preview: choosing a document while writing should not
          // take the author away from the draft, so entries are text, not links.
          <NestedList items={children} depth={depth} renderLabel={(item) => item.label} />
        )}
      </div>
    </NodeViewWrapper>
  )
}

/** Any other leaf directive: the editable line it has always been. */
function PlainLeafDirective() {
  return (
    <NodeViewWrapper className="leaf-directive">
      <NodeViewContent />
    </NodeViewWrapper>
  )
}

function LeafDirectiveView(props: NodeViewProps) {
  switch (directiveName(props.node)) {
    case 'toc':
      return <TableOfContentsBlock {...props} />
    case 'children':
      return <ChildDocumentsBlock {...props} />
    default:
      return <PlainLeafDirective />
  }
}

const withView: Partial<NodeConfig> = {
  addNodeView: () => ReactNodeViewRenderer(LeafDirectiveView),
}

/** Gives leaf directives their author-facing views. */
export function withLeafDirectiveViews(extensions: Extensions): Extensions {
  return extensions.map((extension) =>
    extension.type === 'node' && extension.name === 'leafDirective'
      ? extension.extend(withView)
      : extension,
  )
}
