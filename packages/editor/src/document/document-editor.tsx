import { cx } from '@quill/ui'
import type { SoftBreakMode, Warning } from '@quill/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'

import { BlockMenu } from '../block/block-menu.tsx'
import type { CommentRequest } from '../block/block-menu.tsx'
import { SlashMenu } from '../slash/slash-menu.tsx'
import { createSlashStore } from '../slash/slash-store.ts'
import type { SlashItem, SlashRequest } from '../slash/slash-items.ts'
import type { FileRequest } from './files.ts'
import type { DocumentAst } from '../document-ast.ts'
import { documentFromMdast, documentToMdast } from './ast.ts'
import type { LoadedDocument } from './ast.ts'
import { buildExtensions } from './extensions.ts'

/**
 * The writing surface (ADR-003).
 *
 * It takes an mdast root and gives one back: editor JSON is never the document
 * and is never persisted (ADR-021). The AST is the initial content, not a
 * controlled value — a live editor cannot be driven from outside without
 * destroying the caret on every keystroke — so replacing the document from
 * elsewhere, after a stale draft has been re-read for instance, is done by
 * remounting with a new `key`.
 *
 * Everything the editor needs from the outside arrives as a prop or an injected
 * client: comments raise an event, an image asks for an address, and drafts and
 * locks are hooks the application wires up. The package makes no requests of its
 * own, which is what lets a test run the real editor with fakes.
 */

export interface DocumentEditorHandle {
  /** The document as mdast, with any warning the conversion produced. */
  toMdast(): DocumentAst
  readonly warnings: readonly Warning[]
  readonly editor: Editor | null
}

export interface DocumentEditorProps {
  /** The document to open. Read once; see the note about remounting. */
  readonly ast: DocumentAst
  readonly editable?: boolean
  readonly placeholder?: string
  readonly softBreaks?: SoftBreakMode
  /** Names the editing region for assistive technology. */
  readonly label?: string
  readonly slashItems?: readonly SlashItem[]
  readonly className?: string
  readonly ref?: Ref<DocumentEditorHandle>
  /** Called after every change, with the same handle the ref exposes. */
  onChange?(handle: DocumentEditorHandle): void
  /** A comment was asked for on a range; ADR-022 anchoring is the application's. */
  onComment?(request: CommentRequest): void
  /** The slash menu needs something the editor cannot invent, such as an address. */
  onRequest?(request: SlashRequest): void
  /**
   * Files were dragged onto the document or pasted into it. Uploading them is
   * the application's, which is what holds the attachment client; omitted, a
   * dropped file is left to the browser.
   */
  onFiles?(request: FileRequest): void
}

function handleFor(editor: Editor, warnings: readonly Warning[]): DocumentEditorHandle {
  return { toMdast: () => documentToMdast(editor.state.doc).tree, warnings, editor }
}

export function DocumentEditor({
  ast,
  editable = true,
  placeholder,
  softBreaks,
  label = 'Document',
  slashItems,
  className,
  ref,
  onChange,
  onComment,
  onRequest,
  onFiles,
}: DocumentEditorProps) {
  const store = useMemo(() => createSlashStore(), [])

  // The extension list is built once with the editor, so it reads the current
  // callbacks through a box rather than closing over the first ones it saw.
  const latest = useRef({ onChange, onRequest, onFiles })
  // Keeps that box in sync with the latest onChange/onRequest for the ProseMirror
  // extensions built once below (useEditor), which read it instead of closing
  // over stale props.
  useEffect(() => {
    latest.current = { onChange, onRequest, onFiles }
  }, [onChange, onRequest, onFiles])

  // Converted once, by a lazy initial state rather than a memo: the AST is the
  // initial content, and a later value must not re-open the document under the
  // author's caret. See the note above about remounting, which is how a document
  // is genuinely replaced.
  const [initial] = useState<LoadedDocument>(() =>
    documentFromMdast(ast, softBreaks === undefined ? {} : { softBreaks }),
  )

  /* oxlint-disable react/refs -- the callback box below is read when the author
     acts, never while rendering. The extension list and the editor are built once,
     so a closure over the first callbacks it saw is exactly the staleness this
     box exists to avoid. */
  const editor = useEditor({
    extensions: buildExtensions({
      ...(placeholder === undefined ? {} : { placeholder }),
      files: {
        onFiles: (request) => {
          latest.current.onFiles?.(request)
        },
      },
      slash: {
        store,
        ...(slashItems === undefined ? {} : { items: slashItems }),
        run: (item, instance) => {
          item.run({ editor: instance, request: (request) => latest.current.onRequest?.(request) })
        },
      },
    }),
    content: initial.doc.toJSON(),
    editable,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        // `prose` belongs on the grid itself, not on a wrapper around it: the
        // reading rhythm is expressed as `.prose > * + *`, so a block only
        // takes its spacing when the grid it sits in is the prose root. That
        // is exactly how the reading surface mounts it (`Prose` is the grid),
        // which is what makes a paragraph, a heading, and a table the same
        // distance apart while they are written as when they are read.
        class: 'document-editor-content prose',
      },
    },
    onUpdate: ({ editor: instance }) => {
      latest.current.onChange?.(handleFor(instance, initial.warnings))
    },
  })
  /* oxlint-enable react/refs */

  useImperativeHandle(ref, () => handleFor(editor, initial.warnings), [editor, initial.warnings])

  return (
    <div className={cx('document-editor relative', className)}>
      <BlockMenu editor={editor} {...(onComment === undefined ? {} : { onComment })} />
      <EditorContent editor={editor} />
      <SlashMenu store={store} editor={editor} />
    </div>
  )
}
