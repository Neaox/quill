/**
 * The keyboard shortcuts the editor's menus and toolbars show, as the keymap
 * binds them and as a person reads them.
 *
 * A menu that shows a shortcut the keymap does not bind teaches the wrong
 * thing, so the bindings are named once here and both the keymap
 * (`document/keymap.ts`) and every label read them. `Mod` is ProseMirror's
 * word for Ctrl, or Command on Apple's platforms, where the label says ⌘.
 */
export const SHORTCUTS = {
  bold: 'Mod-b',
  italic: 'Mod-i',
  strike: 'Mod-Shift-x',
  code: 'Mod-e',
  link: 'Mod-k',
  clearFormatting: 'Mod-\\',
  /** Moves focus into the selection toolbar, as Alt+F10 does in Office and Confluence. */
  toolbar: 'Alt-F10',
  toolbarAlternative: 'Mod-Shift-\\',
  /** Opens the context menu at the caret, as the platform's own keys do. */
  contextMenu: 'Shift-F10',
  contextMenuKey: 'ContextMenu',
  moveUp: 'Mod-Shift-ArrowUp',
  moveDown: 'Mod-Shift-ArrowDown',
  /** Find and replace (ADR-051), with VS Code's keys; Mod-Alt-f because a Mac's Command+H hides the window. */
  find: 'Mod-f',
  replace: 'Mod-h',
  replaceAlternative: 'Mod-Alt-f',
  findNext: 'F3',
  findNextAlternative: 'Mod-g',
  findPrevious: 'Shift-F3',
  findPreviousAlternative: 'Mod-Shift-g',
  /** The word at the caret, then each next place it comes. */
  selectNextOccurrence: 'Mod-d',
  /** Lists every keyboard shortcut (`shortcuts/shortcuts-dialog.tsx`). */
  shortcuts: 'Mod-/',
} as const

export type ShortcutName = keyof typeof SHORTCUTS

interface PlatformNavigator {
  readonly platform?: string
  readonly userAgent?: string
}

/** Apple's platforms, where Mod is Command. */
export function isApplePlatform(
  navigator: PlatformNavigator | undefined = globalThis.navigator,
): boolean {
  const name = `${navigator?.platform ?? ''} ${navigator?.userAgent ?? ''}`
  return /Mac|iPhone|iPad|iPod/.test(name)
}

const APPLE_KEYS: Readonly<Record<string, string>> = {
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Ctrl: '⌃',
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

/** A binding as a person reads it: `Ctrl+Shift+X`, or `⌘⇧X` on a Mac. */
export function shortcutLabel(binding: string, apple = isApplePlatform()): string {
  // `Mod-\` ends in a backslash, which is the key, not a separator.
  const parts = binding.split(/-(?=.)/)
  const keys = parts.map((part, index) => {
    const last = index === parts.length - 1
    if (!last) return apple ? (APPLE_KEYS[part] ?? part) : part === 'Mod' ? 'Ctrl' : part
    return KEY_NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part)
  })
  return apple ? keys.join('') : keys.join('+')
}

/** The label of a named shortcut on this platform. */
export function shortcutFor(name: ShortcutName): string {
  return shortcutLabel(SHORTCUTS[name])
}
