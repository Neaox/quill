import { cx } from '@quill/ui'
import type { SoftBreakMode, Warning } from '@quill/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'

import { BlockMenu } from '../block/block-menu.tsx'
import { FindBar } from '../find/find-bar.tsx'
import type { CommentRequest } from '../block/block-menu.tsx'
import type { ChildPagesPreview } from '../navigation/navigation-view.ts'
import type { ImageAction } from '../image/image-actions.ts'
import { BlockInserter } from '../slash/block-inserter.tsx'
import type { DocumentLinkTarget, SlashContribution, SlashRequest } from '../slash/slash-item.ts'
import { SlashMenu } from '../slash/slash-menu.tsx'
import { ShortcutsDialog } from '../shortcuts/shortcuts-dialog.tsx'
import { TableToolbar } from '../table/table-toolbar.tsx'
import { createSlashRecents, emojiRecentsKey } from '../slash/slash-recents.ts'
import { createSlashRegistry } from '../slash/slash-registry.ts'
import { createSlashStore } from '../slash/slash-store.ts'
import { builtInContextMenu } from '../context-menu/built-in-contributions.ts'
import { createContextMenuRegistry } from '../context-menu/context-menu-registry.ts'
import type {
  ClipboardReader,
  ContextMenuContribution,
  ContextMenuEnvironment,
} from '../context-menu/context-menu-registry.ts'
import { EditorOverlays } from '../context-menu/editor-overlays.tsx'
import { anchorOf, createOverlayStore } from '../context-menu/overlay-store.ts'
import { restoreWrapping } from '../code-block/code-block-menu.ts'
import type { FileRequest } from './files.ts'
import type { EditorEmojiOptions } from './emoji.ts'
import type { DocumentAst } from '../document-ast.ts'
import { documentFromMdast, documentToMdast } from './ast.ts'
import type { LoadedDocument } from './ast.ts'
import { buildExtensions } from './extensions.ts'
import { isPasteLanding } from './paste.ts'
import { replaceDocument } from './replace-document.ts'

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
   * Makes the editor hold `ast` as an edit of its own: only the stretch that
   * differs is replaced, the caret outside it stays put, and it is one step
   * that Undo reverses (putting changes back from a review, say). Not a reset:
   * for a different document, remount with a new `key`.
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
  /**
   * Lists this page's children for a child pages block's preview (ADR-056);
   * the request is the application's. Omitted, the block says in words what
   * it will list. Whether it is given is read once, when the editor is built.
   */
  childPages?: ChildPagesPreview
  /**
   * Opens a link the way the application opens links: the router for a
   * `/d/<id>` link, a new tab for anything else. Omitted, Open is disabled
   * with its reason in the link card and the menus.
   */
  onOpenLink?(href: string): void
  /**
   * The address of this document at a fragment, for "Copy link to section".
   * Omitted, the entry says why it cannot be used.
   */
  linkTo?(fragment: string): string | undefined
  /**
   * Parts a feature or an extension adds to the context menu, after Quill's
   * own (`context-menu/context-menu-registry.ts`). Read once, when the editor
   * is built.
   */
  readonly contextMenuContributions?: readonly ContextMenuContribution[]
  /**
   * The clipboard the menus copy to and paste from: the browser's own, unless
   * a caller — a test, an embedding — supplies one.
   */
  readonly clipboard?: EditorClipboard | undefined
}

/** The parts of the browser's Clipboard API the editor's menus use. */
export interface EditorClipboard extends ClipboardReader {
  writeText?(text: string): Promise<void>
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
  className,
  ref,
  onChange,
  onComment,
  onRequest,
  onFiles,
  searchDocuments,
  childPages,
  onOpenLink,
  linkTo,
  contextMenuContributions,
  clipboard = globalThis.navigator.clipboard,
}: DocumentEditorProps) {
  const store = useMemo(() => createSlashStore(), [])
  // What floats over the document — the context menu, the link popover — and
  // the toolbar's way of taking focus, which Alt+F10 asks for.
  const overlays = useMemo(() => createOverlayStore(), [])
  // Nothing to focus until the toolbar is drawn: the key is the page's.
  // The toolbar's layout effect sets it as the editor mounts, before any key can ask.
  /* v8 ignore next */
  const focusToolbar = useRef<() => boolean>(() => false)
  // Every keyboard shortcut, listed on Ctrl+/.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [contextMenu] = useState(() =>
    createContextMenuRegistry([
      ...builtInContextMenu(imageActions),
      ...(contextMenuContributions ?? []),
    ]),
  )

  // The extension list is built once with the editor, so it reads the current
  // callbacks through a box rather than closing over the first ones it saw.
  const latest = useRef({ onChange, onRequest, onFiles, searchDocuments, childPages })
  // Keeps that box in sync with the latest onChange/onRequest for the ProseMirror
  // extensions built once below (useEditor), which read it instead of closing
  // over stale props.
  useEffect(() => {
    latest.current = { onChange, onRequest, onFiles, searchDocuments, childPages }
  }, [onChange, onRequest, onFiles, searchDocuments, childPages])

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
  // The emoji chosen last, kept beside the person's blocks under a key of their own.
  const [emojiRecents] = useState(() => createSlashRecents(emojiRecentsKey(recentsKey)))

  // Built once, as everything above says, and handed to `useEditor` as the same objects on every
  // render: it compares its options by identity, so a fresh list, content or props each time
  // reconfigures the whole document (every plugin and decoration) whenever a parent renders, as
  // it does on each autosave status change.
  const [extensions] = useState(() =>
    buildExtensions({
      ...(placeholder === undefined ? {} : { placeholder }),
      ...(labels === undefined ? {} : { labels }),
      ...(emoji === undefined ? {} : { emoji }),
      ...(imageActions === undefined ? {} : { imageActions }),
      emojiRecents,
      onShowShortcuts: () => {
        setShortcutsOpen(true)
      },
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
      callouts: {
        onTypeMenu: ({ pos, anchor }) => {
          overlays.open({
            kind: 'context-menu',
            anchor: anchorOf(anchor.getBoundingClientRect()),
            presentation: 'menu',
            pos,
            only: ['callout'],
            label: 'Callout type',
            returnFocus: () => {
              anchor.focus()
            },
          })
        },
      },
      ...(editable ? { menus: { store: overlays, focusToolbar } } : {}),
      ...(childPages === undefined
        ? {}
        : {
            navigation: {
              childPages: async (query, signal) =>
                (await latest.current.childPages?.(query, signal)) ?? { html: '', count: 0 },
            },
          }),
    }),
  )
  const [content] = useState(() => initial.doc.toJSON())
  const editorProps = useMemo(
    () => ({
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
    }),
    [label],
  )

  const editor = useEditor({
    extensions,
    content,
    editable,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps,
    onUpdate: ({ editor: instance }) => {
      // A large paste lands in batches; the change is heard once, when the
      // last has landed, so a document is never saved half pasted.
      if (isPasteLanding(instance.state)) return
      latest.current.onChange?.(handleFor(instance, initial.warnings))
    },
  })
  /* oxlint-enable react/refs */

  useImperativeHandle(ref, () => handleFor(editor, initial.warnings), [editor, initial.warnings])

  // What the menus may do outside the editor, through the application.
  const environment = useMemo<ContextMenuEnvironment>(() => {
    const write = clipboard?.writeText?.bind(clipboard)
    return {
      ...(onOpenLink === undefined ? {} : { openLink: onOpenLink }),
      ...(linkTo === undefined ? {} : { linkTo }),
      ...(write === undefined ? {} : { copyText: write }),
      clipboard,
      ...(onRequest === undefined
        ? {}
        : {
            requestImage: () => {
              onRequest({ kind: 'image' })
            },
          }),
    }
  }, [onOpenLink, linkTo, onRequest, clipboard])

  // Puts this person's "wrap long lines" back on the code blocks: a choice
  // kept in the browser, applied to the editor's DOM.
  useEffect(() => {
    restoreWrapping(editor.view)
  }, [editor])

  return (
    <div className={cx('document-editor relative', className)}>
      <FindBar editor={editor} />
      <BlockMenu editor={editor} {...(onComment === undefined ? {} : { onComment })} />
      {editable ? <BlockInserter editor={editor} /> : null}
      {editable ? <TableToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
      <SlashMenu store={store} editor={editor} />
      {editable ? (
        <EditorOverlays
          editor={editor}
          store={overlays}
          registry={contextMenu}
          environment={environment}
          focusToolbar={focusToolbar}
          onComment={onComment}
          {...(searchDocuments === undefined ? {} : { searchDocuments })}
        />
      ) : null}
      <ShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        onCloseAutoFocus={(event) => {
          // Back to the words, not to the page's first control.
          event.preventDefault()
          editor.commands.focus()
        }}
      />
    </div>
  )
}
