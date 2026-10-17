import { Editor, getExtensionField } from '@tiptap/core'
import type { AnyExtension, KeyboardShortcutCommand } from '@tiptap/core'
import { afterAll, describe, expect, it } from 'vitest'

import { createOverlayStore } from '../context-menu/overlay-store.ts'
import { buildExtensions } from '../document/extensions.ts'
import { barCommandFor } from '../find/find-keys.ts'
import { createSlashRecents } from '../slash/slash-recents.ts'
import { createSlashRegistry } from '../slash/slash-registry.ts'
import { createSlashStore } from '../slash/slash-store.ts'
import { FIND_BAR_SHORTCUTS, SHORTCUT_GROUPS, listedKeys } from './shortcut-catalogue.ts'

/**
 * The list a writer is shown is kept honest here, in both directions: nothing is
 * listed that is not bound, and nothing is bound that is not listed, so a new
 * shortcut cannot ship without its line. "Bound" is read from the editor itself,
 * built with every option the writing surface gives it, so every extension's
 * keymap is asked, not a copy of it.
 */

const editor = new Editor({
  element: null,
  extensions: buildExtensions({
    slash: {
      store: createSlashStore(),
      registry: createSlashRegistry(),
      recents: createSlashRecents(undefined),
      request: () => undefined,
    },
    menus: { store: createOverlayStore(), focusToolbar: { current: () => false } },
    onShowShortcuts: () => undefined,
  }),
})

afterAll(() => {
  editor.destroy()
})

/** The keys an extension binds, as TipTap asks it for them. */
function keysOf(extension: AnyExtension): readonly string[] {
  const add = getExtensionField<(() => Record<string, KeyboardShortcutCommand>) | undefined>(
    extension,
    'addKeyboardShortcuts',
    {
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
      editor,
      type: undefined,
      parent: undefined,
    },
  )
  return Object.keys(add?.() ?? {})
}

const bound = new Set(editor.extensionManager.extensions.flatMap(keysOf))

/**
 * Bound, but not shortcuts: the keys that only write, erase or move the caret,
 * which the editor takes for itself in places (out of a block, into a table,
 * out of inline code, a details' summary, closing the find bar), and the core's
 * own defaults (select to the line's ends on a Mac).
 */
const NOT_SHORTCUTS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Delete',
  'Escape',
  'Mod-Backspace',
  'Mod-Delete',
  'Shift-Backspace',
  'Ctrl-h',
  'Alt-Backspace',
  'Ctrl-d',
  'Ctrl-Alt-Backspace',
  'Alt-Delete',
  'Alt-d',
  'Ctrl-a',
  'Ctrl-e',
  'Home',
  'End',
])

/** As a key event, so the find bar's own reading of keys can be asked. */
function asEvent(binding: string) {
  const parts = binding.split('-')
  const name = parts.at(-1) ?? ''
  return {
    key: name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
    shiftKey: parts.includes('Shift'),
    altKey: parts.includes('Alt'),
    ctrlKey: parts.includes('Mod'),
    metaKey: false,
  }
}

describe('the keyboard shortcuts a writer is shown', () => {
  const listed = listedKeys()
  const findBar = listedKeys([{ title: 'Find bar', shortcuts: FIND_BAR_SHORTCUTS }])

  it('lists only keys that something is bound to', () => {
    const unbound = [...listed].filter((each) => !bound.has(each) && !findBar.has(each))

    expect(unbound).toEqual([])
  })

  it('lists every key the editor binds, bar the ones that only write or move the caret', () => {
    const unlisted = [...bound].filter((each) => !listed.has(each) && !NOT_SHORTCUTS.has(each))

    expect(unlisted).toEqual([])
  })

  it('lists the find bar’s keys as the find bar reads them', () => {
    for (const shortcut of FIND_BAR_SHORTCUTS) {
      const field = shortcut.keys.endsWith('Enter') ? 'replace' : 'find'
      expect({
        keys: shortcut.keys,
        command: barCommandFor(asEvent(shortcut.keys), field),
      }).toEqual({
        keys: shortcut.keys,
        command: expect.any(String),
      })
    }
  })

  it('names every shortcut in words, once in its group, under a heading', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(group.title).not.toBe('')
      expect(group.shortcuts.length).toBeGreaterThan(0)
      const labels = group.shortcuts.map((shortcut) => shortcut.label)
      expect(new Set(labels).size).toBe(labels.length)
      for (const label of labels) expect(label).not.toBe('')
    }
  })

  it('takes the table’s shortcuts from the actions the table toolbar draws', () => {
    const tables = SHORTCUT_GROUPS.find((group) => group.title === 'Tables')

    expect(tables?.shortcuts.map((shortcut) => shortcut.label)).toEqual(
      expect.arrayContaining(['Insert row above', 'Delete column', 'Move row up']),
    )
  })

  it('lists the typed triggers by the text that is typed', () => {
    const typed = SHORTCUT_GROUPS.flatMap((group) => group.shortcuts).flatMap((shortcut) =>
      shortcut.kind === 'typed' ? [shortcut.text] : [],
    )

    expect(typed).toEqual(['/', ':'])
  })
})
