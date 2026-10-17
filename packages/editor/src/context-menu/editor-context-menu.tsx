import { ContextMenu } from '@quill/ui'
import type {
  ContextMenuAction,
  ContextMenuChoice,
  ContextMenuEntry,
  ContextMenuSection as UiSection,
} from '@quill/ui'
import type { Editor } from '@tiptap/react'
import { useEffect, useSyncExternalStore } from 'react'

import type {
  ContextMenuEnvironment,
  ContextMenuRegistry,
  ContextMenuSection,
  MenuAction,
  MenuChoice,
  MenuEditorBridge,
  MenuEntry,
} from './context-menu-registry.ts'
import type { OverlayStore } from './overlay-store.ts'

/**
 * The context menu, drawn: the registry's sections for the place it was
 * opened at, in the design system's `ContextMenu` (`@quill/ui`).
 */

function uiLeaf(entry: MenuAction | MenuChoice): ContextMenuAction | ContextMenuChoice {
  if (entry.kind === 'choice') {
    return {
      kind: 'choice',
      id: entry.id,
      label: entry.label,
      value: entry.value,
      options: entry.options.map(({ icon: Icon, ...option }) => ({
        ...option,
        ...(Icon === undefined ? {} : { icon: <Icon /> }),
      })),
      onValueChange: entry.choose,
    }
  }
  const Icon = entry.icon
  return {
    kind: 'action',
    id: entry.id,
    label: entry.label,
    icon: Icon === undefined ? undefined : <Icon />,
    shortcut: entry.shortcut,
    disabledReason: entry.disabledReason,
    tone: entry.tone,
    checked: entry.checked,
    onSelect: entry.run,
  }
}

function uiEntry(entry: MenuEntry): ContextMenuEntry {
  if (entry.kind !== 'submenu') return uiLeaf(entry)
  const Icon = entry.icon
  return {
    kind: 'submenu',
    id: entry.id,
    label: entry.label,
    icon: Icon === undefined ? undefined : <Icon />,
    entries: entry.entries.map(uiLeaf),
  }
}

/**
 * A menu opened from one control — a toolbar's "Turn into" — that has one
 * submenu in it is that submenu: a menu whose only item opens another is a
 * step for nothing.
 */
export function unwrapLone(sections: readonly ContextMenuSection[]): readonly ContextMenuSection[] {
  const [only] = sections
  const [entry] = only?.entries ?? []
  if (sections.length !== 1 || only?.entries.length !== 1 || entry?.kind !== 'submenu') {
    return sections
  }
  return [{ id: only.id, label: entry.label, entries: entry.entries }]
}

export interface EditorContextMenuProps {
  readonly editor: Editor
  readonly store: OverlayStore
  readonly registry: ContextMenuRegistry
  readonly environment: ContextMenuEnvironment
  readonly bridge: MenuEditorBridge
}

export function EditorContextMenu({
  editor,
  store,
  registry,
  environment,
  bridge,
}: EditorContextMenuProps) {
  const overlay = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const open = overlay.kind === 'context-menu'
  const sections = open
    ? unwrapLone(
        registry.sectionsFor(
          {
            view: editor.view,
            state: editor.state,
            pos: Math.min(overlay.pos, editor.state.doc.content.size),
            environment,
            editor: bridge,
          },
          overlay.only,
        ),
      )
    : []
  const empty = open && sections.length === 0

  // Nothing to offer at this place: the store, which the menu's opener
  // reads, is told the menu is not open after all.
  useEffect(() => {
    if (empty) store.close()
  }, [empty, store])

  if (!open || empty) return null

  const drawn: UiSection[] = sections.map((section) => ({
    id: section.id,
    // A menu opened for one thing is named for it; its section needs no heading as well.
    label: overlay.only === undefined ? section.label : undefined,
    entries: section.entries.map(uiEntry),
  }))

  return (
    <ContextMenu
      open
      label={overlay.label}
      anchor={overlay.anchor}
      presentation={overlay.presentation}
      sections={drawn}
      onOpenChange={() => {
        // Only ever to close. An entry may have opened something else in the
        // menu's place — the link popover — which closing the menu must not close.
        if (store.getSnapshot() === overlay) store.close()
      }}
      onCloseFocus={() => {
        // Only focus the closing took away goes back. An entry that put the
        // caret somewhere — a new title, selected to type over — has said
        // where focus goes, and a menu opened since has it now.
        // Something an entry opened in the menu's place — the link popover —
        // takes focus itself.
        const active = document.activeElement
        const lost = active === null || active === document.body
        if (lost && store.getSnapshot().kind === 'none') overlay.returnFocus()
      }}
    />
  )
}
