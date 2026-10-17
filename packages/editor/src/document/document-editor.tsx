import { cx } from '@quill/ui'
import type { SoftBreakMode, Warning } from '@quill/markdown'
import type { NestedListItem } from '@quill/ui'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'

import { BlockMenu } from '../block/block-menu.tsx'
import { ChildDocumentsProvider } from '../blocks/child-documents-context.tsx'
import { LinkPreviewProvider, NO_LINK_PREVIEWS } from '../blocks/link-preview-context.tsx'
import type { LinkPreviewSource } from '../blocks/link-preview-context.tsx'
import type { CommentRequest } from '../block/comment-request.ts'
import { EditorContextMenu } from '../context-menu/editor-context-menu.tsx'
import type { ImageAction } from '../image/image-actions.ts'
import { CalloutVariantMenu } from '../callout/callout-variant-menu.tsx'
import { BlockInserter } from '../slash/block-inserter.tsx'
import type { DocumentLinkTarget, SlashContribution, SlashRequest } from '../slash/slash-item.ts'
import { SlashMenu } from '../slash/slash-menu.tsx'
import { createSlashRecents, emojiRecentsKey } from '../slash/slash-recents.ts'
import { createSlashRegistry } from '../slash/slash-registry.ts'
import { FindBar } from '../find/find-bar.tsx'
import { ShortcutsDialog } from '../shortcuts/shortcuts-dialog.tsx'
import { withLinkDefaultDisplay } from '../link/link-default-display.ts'
import { FormattingToolbar } from '../toolbar/formatting-toolbar.tsx'
import { LinkEmbedSync } from '../link/link-embed-sync.tsx'
import { LiveLinkTitles } from '../link/live-link-titles.tsx'
import { LinkOfferBar } from '../toolbar/link-offer-bar.tsx'
import { useDetailsEditing, useLinkEditing } from '../toolbar/hooks.ts'
import { createSlashStore } from '../slash/slash-store.ts'
import type { FileRequest } from './files.ts'
import type { EditorEmojiOptions } from './emoji.ts'
import type { DocumentAst } from '../document-ast.ts'
import { replaceDocument } from './replace-document.ts'
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
  /**
   * Makes the editor hold this document, as one undoable step that leaves what did not
   * change as it was. For a change made on the author's behalf (putting back what they
   * asked to put back); a different document is opened by remounting, not by this.
   */
  replaceContent(ast: DocumentAst): void
  readonly warnings: readonly Warning[]
  readonly editor: Editor | null
}

export interface DocumentEditorProps {
  /** The document to open. Read once; see the note about remounting. */
  readonly ast: DocumentAst
  readonly editable?: boolean
  readonly placeholder?: string
  /**
   * How a paragraph wrapped in the source opens. `collapse`, the default, is
   * what a reader sees: the editing surface keeps whitespace, so a source
   * newline would otherwise show as a line break the reading view does not
   * have. Nothing is saved for it until the author edits, and the first save
   * after that carries the formatting-only normalisation ADR-002 licenses
   * once. `preserve` keeps the newlines, for a caller that needs the tree as
   * it came.
   */
  readonly softBreaks?: SoftBreakMode
  /**
   * The organisation's label names (ADR-037), so `:acme[Acme]` is drawn
   * as a label while it is written and a name that is none of them is
   * warned about. Read once, when the editor is built; undefined while the
   * names are not yet known.
   */
  readonly labels?: readonly string[] | undefined
  /**
   * The organisation's own emoji and each label's leading one (ADR-038), so
   * `:acme:` is drawn while it is written. Read once, when the editor is
   * built; GitHub's shortcodes need nothing.
   */
  readonly emoji?: EditorEmojiOptions | undefined
  /** Names the editing region for assistive technology. */
  readonly label?: string
  /**
   * Items a feature or a Markdown extension adds to the slash menu, after
   * Quill's own (ADR-039). Read once, when the editor is built.
   */
  readonly slashContributions?: readonly SlashContribution[]
  /**
   * Actions on images that an extension owns, such as draw.io's "Edit
   * diagram" (ADR-043). Read once, when the editor is built.
   */
  readonly imageActions?: readonly ImageAction[]
  /**
   * Where the slash menu remembers what this person inserted last: a key in
   * the browser's local storage, which the application makes per person.
   */
  readonly recentsKey?: string
  /**
   * The documents beneath this one, nested, for the child-documents block to
   * show. The editor cannot look them up itself; omitted, the block says there
   * are none.
   */
  readonly childDocuments?: readonly NestedListItem[] | undefined
  /**
   * How to look up the preview of a link, for the link cards it draws (ADR-042). The editor
   * cannot ask the server itself; omitted, a card is drawn from its address alone.
   */
  readonly linkPreviews?: LinkPreviewSource | undefined
  readonly className?: string
  readonly ref?: Ref<DocumentEditorHandle>
  /**
   * Called after every change, with the same handle the ref exposes. It runs
   * on every keystroke, so it must stay cheap: hand `handle.toMdast` on to be
   * called later rather than calling it here, because converting a long
   * document takes several frames (quill-plan.md section 31).
   */
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
  /**
   * Finds documents for "Link to document" in the slash menu; the request is
   * the application's. Omitted, the menu does not offer the item. Whether it
   * is given is read once, when the editor is built.
   */
  searchDocuments?(query: string, signal: AbortSignal): Promise<readonly DocumentLinkTarget[]>
}

function handleFor(editor: Editor, warnings: readonly Warning[]): DocumentEditorHandle {
  return {
    toMdast: () => documentToMdast(editor.state.doc).tree,
    replaceContent: (ast) => {
      replaceDocument(
        editor,
        documentFromMdast(ast, { softBreaks: 'collapse', schema: editor.schema }).doc,
      )
    },
    warnings,
    editor,
  }
}

export function DocumentEditor({
  ast,
  editable = true,
  placeholder,
  softBreaks,
  labels,
  emoji,
  label = 'Document',
  slashContributions,
  imageActions,
  recentsKey,
  childDocuments,
  linkPreviews,
  className,
  ref,
  onChange,
  onComment,
  onRequest,
  onFiles,
  searchDocuments,
}: DocumentEditorProps) {
  const store = useMemo(() => createSlashStore(), [])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // The extension list is built once with the editor, so it reads the current
  // callbacks through a box rather than closing over the first ones it saw.
  const latest = useRef({ onChange, onRequest, onFiles, searchDocuments })
  // Keeps that box in sync with the latest onChange/onRequest for the ProseMirror
  // extensions built once below (useEditor), which read it instead of closing
  // over stale props.
  useEffect(() => {
    latest.current = { onChange, onRequest, onFiles, searchDocuments }
  }, [onChange, onRequest, onFiles, searchDocuments])

  // Converted once, by a lazy initial state rather than a memo: the AST is the
  // initial content, and a later value must not re-open the document under the
  // author's caret. See the note above about remounting, which is how a document
  // is genuinely replaced.
  const [initial] = useState<LoadedDocument>(() =>
    documentFromMdast(ast, { softBreaks: softBreaks ?? 'collapse' }),
  )

  /* oxlint-disable react/refs -- the callback box below is read when the author
     acts, never while rendering. The extension list and the editor are built once,
     so a closure over the first callbacks it saw is exactly the staleness this
     box exists to avoid. */
  // The slash menu's catalogue and memory, built once with the editor from
  // what is known then: an item that needs the organisation's labels is
  // offered when there are labels to offer.
  const [slash] = useState(() => ({
    registry: createSlashRegistry({
      ...(slashContributions === undefined ? {} : { contributions: slashContributions }),
      environment: {
        ...(labels === undefined ? {} : { labels }),
        ...(emoji === undefined ? {} : { customEmoji: emoji.custom }),
        ...(searchDocuments === undefined
          ? {}
          : {
              searchDocuments: async (query: string, signal: AbortSignal) =>
                (await latest.current.searchDocuments?.(query, signal)) ?? [],
            }),
      },
    }),
    recents: createSlashRecents(recentsKey),
  }))
  // What was chosen last from the emoji menu, kept apart from the slash menu's blocks.
  const [emojiRecents] = useState(() => createSlashRecents(emojiRecentsKey(recentsKey)))

  const editor = useEditor({
    extensions: buildExtensions({
      ...(placeholder === undefined ? {} : { placeholder }),
      ...(labels === undefined ? {} : { labels }),
      ...(emoji === undefined ? {} : { emoji }),
      emojiRecents,
      onShowShortcuts: () => {
        setShortcutsOpen(true)
      },
      ...(imageActions === undefined ? {} : { imageActions }),
      files: {
        onFiles: (request) => {
          latest.current.onFiles?.(request)
        },
      },
      slash: {
        store,
        ...slash,
        request: (request) => {
          latest.current.onRequest?.(request)
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

  const linkEditing = useLinkEditing(editor)
  const detailsEditing = useDetailsEditing(editor)

  // Tells the editor's state what an unchosen link is shown as, which the organisation decides
  // (ADR-042). The commands that ask what a link is shown as read it from the state, so it is
  // put there when the application learns it, and again if it changes.
  const defaultDisplay = linkPreviews?.defaultDisplay
  // Synchronises the ProseMirror state, which React does not render, with the application's setting.
  useEffect(() => {
    if (defaultDisplay === undefined || editor.isDestroyed) return
    editor.view.dispatch(withLinkDefaultDisplay(editor.state.tr, defaultDisplay))
  }, [editor, defaultDisplay])

  return (
    <div className={cx('document-editor relative', className)}>
      <LinkPreviewProvider value={linkPreviews ?? NO_LINK_PREVIEWS}>
        <FindBar editor={editor} />
        <BlockMenu editor={editor} {...(onComment === undefined ? {} : { onComment })} />
        {editable ? <BlockInserter editor={editor} /> : null}
        <ChildDocumentsProvider value={childDocuments}>
          <EditorContent editor={editor} />
        </ChildDocumentsProvider>
        <SlashMenu store={store} editor={editor} />
        <FormattingToolbar
          editor={editor}
          linkEditing={linkEditing}
          detailsEditing={detailsEditing}
          onComment={onComment}
        />
        <LinkEmbedSync editor={editor} />
        <LinkOfferBar editor={editor} />
        <LiveLinkTitles editor={editor} />
        <EditorContextMenu editor={editor} linkEditing={linkEditing} onComment={onComment} />
        <CalloutVariantMenu editor={editor} />
        <ShortcutsDialog
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
          onCloseAutoFocus={(event) => {
            // Back to the words, not to the page's first control.
            event.preventDefault()
            editor.commands.focus()
          }}
        />
      </LinkPreviewProvider>
    </div>
  )
}
