import { describe, expect, it } from 'vitest'

import { keyboardShortcuts } from '../document/keymap.ts'
import { editorSchema } from '../schema/editor-schema.ts'
import { SHORTCUT_GROUPS, listedKeys } from './shortcut-catalogue.ts'

/**
 * The list a writer is shown is kept honest here, in both directions: nothing is listed that is not
 * bound, and nothing is bound that is not listed, so a new shortcut cannot ship without its line.
 */

const bound = new Set(Object.keys(keyboardShortcuts(editorSchema)))

/** Bound by an extension of its own, which is where each is tested. */
const BOUND_ELSEWHERE = new Set([
  'Mod-Enter', // task-item-view.ts: check or uncheck a task
  'Mod-/', // shortcuts-help.ts: this list
  // find-extension.ts: opening find and stepping through it from the document.
  'Mod-f',
  'Mod-h',
  'Mod-Alt-f',
  'F3',
  'Mod-g',
  'Shift-F3',
  'Mod-Shift-g',
  // find-keys.ts: the keys of the find bar's own fields.
  'Alt-c',
  'Alt-w',
  'Alt-r',
  'Alt-p',
  'Alt-l',
  'Mod-Alt-Enter',
])

/** Plain arrow keys are not shortcuts: the editor only steps the caret out of, and into, blocks with them. */
const UNLISTED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

describe('the keyboard shortcuts a writer is shown', () => {
  const listed = listedKeys()

  it('lists only keys that something is bound to', () => {
    const unbound = [...listed].filter((key) => !bound.has(key) && !BOUND_ELSEWHERE.has(key))

    expect(unbound).toEqual([])
  })

  it('lists every key the keymap binds, bar the plain arrows', () => {
    const unlisted = [...bound].filter((key) => !listed.has(key) && !UNLISTED.has(key))

    expect(unlisted).toEqual([])
  })

  it('names every shortcut in words, and groups them under headings', () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(group.title).not.toBe('')
      expect(group.shortcuts.length).toBeGreaterThan(0)
      for (const shortcut of group.shortcuts) expect(shortcut.label).not.toBe('')
    }
  })

  it('takes the formatting and block shortcuts from the definitions the toolbar and menu use', () => {
    const labels = SHORTCUT_GROUPS.flatMap((group) =>
      group.shortcuts.map((shortcut) => shortcut.label),
    )

    expect(labels).toEqual(
      expect.arrayContaining(['Bold', 'Italic', 'Heading 1', 'Task list', 'Code block']),
    )
  })

  it('lists the typed triggers by the text that is typed', () => {
    const typed = SHORTCUT_GROUPS.flatMap((group) => group.shortcuts).flatMap((shortcut) =>
      shortcut.kind === 'typed' ? [shortcut.text] : [],
    )

    expect(typed).toEqual(['/', ':'])
  })
})
