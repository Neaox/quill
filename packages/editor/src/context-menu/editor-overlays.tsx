import type { Editor } from '@tiptap/react'
import { useMemo, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'

import type { CommentRequest } from '../block/block-menu.tsx'
import { SelectionToolbar } from '../format/selection-toolbar.tsx'
import { createSelectionWatch } from '../format/selection-watch.ts'
import { AltTextPopover, openAltText } from '../image/alt-text-popover.tsx'
import { LinkCard } from '../link/link-card.tsx'
import { LinkPopover } from '../link/link-popover.tsx'
import { openLinkPopover, rangeBox } from '../link/open-link-popover.ts'
import type { DocumentLinkTarget } from '../slash/slash-item.ts'
import type {
  ContextMenuEnvironment,
  ContextMenuRegistry,
  MenuEditorBridge,
} from './context-menu-registry.ts'
import { EditorContextMenu } from './editor-context-menu.tsx'
import type { OverlayStore } from './overlay-store.ts'

/**
 * Everything that floats over the writing surface besides the slash menu:
 * the selection toolbar, the link card and popover, the alternative-text
 * field, and the context menu. They share one overlay store, so only one of
 * them is ever open, and one watch of how the author is working, so they
 * agree about when to step aside.
 */

export interface EditorOverlaysProps {
  readonly editor: Editor
  readonly store: OverlayStore
  readonly registry: ContextMenuRegistry
  readonly environment: ContextMenuEnvironment
  readonly focusToolbar: RefObject<() => boolean>
  readonly onComment?: ((request: CommentRequest) => void) | undefined
  searchDocuments?(query: string, signal: AbortSignal): Promise<readonly DocumentLinkTarget[]>
}

export function EditorOverlays({
  editor,
  store,
  registry,
  environment,
  focusToolbar,
  onComment,
  searchDocuments,
}: EditorOverlaysProps) {
  const [watch] = useState(() => createSelectionWatch(editor))
  const overlay = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const bridge = useMemo<MenuEditorBridge>(
    () => ({
      editLink: () => {
        openLinkPopover(editor.view, store)
      },
      editAltText: (pos) => {
        openAltText(editor.view, store, pos)
      },
    }),
    [editor, store],
  )

  return (
    <>
      <SelectionToolbar
        editor={editor}
        watch={watch}
        store={store}
        environment={environment}
        onComment={onComment}
        focusRef={focusToolbar}
        onLink={bridge.editLink}
      />
      <LinkCard
        editor={editor}
        watch={watch}
        store={store}
        environment={environment}
        onEdit={(link) => {
          store.open({
            kind: 'link',
            anchor: rangeBox(editor.view, link.from, link.to),
            from: link.from,
            to: link.to,
          })
        }}
      />
      {overlay.kind === 'link' ? (
        <LinkPopover
          key={`${String(overlay.from)}:${String(overlay.to)}`}
          editor={editor}
          overlay={overlay}
          store={store}
          environment={environment}
          {...(searchDocuments === undefined ? {} : { searchDocuments })}
        />
      ) : null}
      {overlay.kind === 'alt-text' ? (
        <AltTextPopover key={overlay.pos} editor={editor} overlay={overlay} store={store} />
      ) : null}
      <EditorContextMenu
        editor={editor}
        store={store}
        registry={registry}
        environment={environment}
        bridge={bridge}
      />
    </>
  )
}
