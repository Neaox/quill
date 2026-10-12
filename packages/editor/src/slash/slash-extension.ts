import { Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Suggestion } from '@tiptap/suggestion'
import type { SuggestionProps } from '@tiptap/suggestion'

import type { SlashItem, SlashPicker, SlashRequest } from './slash-item.ts'
import { rankMatches } from './slash-rank.ts'
import type { SlashRecents } from './slash-recents.ts'
import type { SlashRegistry } from './slash-registry.ts'
import { runSlashItem } from './slash-run.ts'
import type { SlashRange } from './slash-run.ts'
import { slashSections } from './slash-sections.ts'
import type { SlashRect, SlashStore } from './slash-store.ts'

/**
 * `/` opens the insert menu (the plan document, section 17).
 *
 * The plugin owns when a query starts and where it ends; the store owns what
 * the author sees. A slash starts a query only where a writer means one: at
 * the start of a line or after a space, never inside a word, an address, or
 * code. Escape closes the menu and leaves what was typed as text; a space
 * that leaves nothing matching closes it too, so "either / or" is just words.
 */

export interface SlashMenuOptions {
  readonly store: SlashStore
  readonly registry: SlashRegistry
  readonly recents: SlashRecents
  /** The item needs something only the application can supply. */
  request(request: SlashRequest): void
}

/** The caret's box, when the browser can say where the caret is. */
export function rectOf(clientRect: SuggestionProps<SlashItem>['clientRect']): SlashRect | null {
  const rect = clientRect?.()
  return rect === null || rect === undefined
    ? null
    : { top: rect.top, bottom: rect.bottom, left: rect.left }
}

/** The caret's box in the view, for a picker opened once the query is gone. */
export function caretRect(view: EditorView): SlashRect | null {
  try {
    const { top, bottom, left } = view.coordsAtPos(view.state.selection.from)
    return { top, bottom, left }
  } catch {
    // A view with no layout — a test without one, a detached editor — has no caret to measure.
    return null
  }
}

/**
 * Whether a trigger character at `range.from` starts a query: in a line of
 * text that is not code, outside inline code and links, and at the start of
 * the line or after whitespace. The slash and the emoji colon share the rule,
 * because both are asking for something only where a writer means to ask.
 */
export function triggerAllowed(state: EditorState, range: SlashRange): boolean {
  const $slash = state.doc.resolve(range.from)
  const line = $slash.parent
  if (
    line.type.spec.code === true ||
    (line.type.name !== 'paragraph' && line.type.name !== 'heading')
  ) {
    return false
  }
  const marks = state.doc.resolve(range.from + 1).marks()
  if (marks.some((mark) => mark.type.spec.code === true || mark.type.name === 'link')) return false
  const offset = $slash.parentOffset
  if (offset === 0) return true
  return /\s/u.test(line.textBetween(offset - 1, offset, undefined, '￼'))
}

/**
 * Whether a query keeps the menu open. A space straight after the slash is
 * prose, and a space after a query nothing matches means the author has
 * moved on.
 */
export function queryContinues(query: string, items: readonly SlashItem[]): boolean {
  if (/^\s/u.test(query)) return false
  if (!/\s/u.test(query)) return true
  return rankMatches(query, items).length > 0
}

export function slashMenu(options: SlashMenuOptions): Extension {
  const { store, registry, recents } = options

  return Extension.create({
    name: 'slashMenu',
    // Ahead of the core keymap, so Enter and Tab choose an item while the
    // menu is open instead of splitting the line under it.
    priority: 1100,
    addProseMirrorPlugins() {
      const editor = this.editor

      const pick = (picker: SlashPicker): void => {
        const view = editor.view
        const refocus = () => {
          view.focus()
        }
        store.showPicker({
          picker,
          rect: caretRect(view),
          choose: (option) => {
            store.close()
            refocus()
            // The editor's selection is where the item was chosen: the
            // picker took the focus, not the caret.
            picker.choose(option)(view.state, (transaction) => {
              view.dispatch(transaction)
            })
          },
          cancel: () => {
            store.close()
            refocus()
          },
        })
      }

      const show = (props: SuggestionProps<SlashItem>): void => {
        // The plugin reports each keystroke twice: once while it asks for the
        // items, with none, and once with them. Showing the first would
        // flash "no blocks match" on every key.
        if (props.loading) return
        store.showMenu({
          query: props.query,
          sections: slashSections(props.query, props.items, recents.read()),
          rect: rectOf(props.clientRect),
          apply: (item) => {
            props.command(item)
          },
        })
      }

      return [
        Suggestion<SlashItem>({
          editor,
          char: '/',
          allowSpaces: true,
          allowedPrefixes: null,
          allow: ({ state, range }) => triggerAllowed(state, range),
          shouldShow: ({ query, editor: current }) =>
            queryContinues(query, registry.available(current.state)),
          items: ({ editor: current }) => [...registry.available(current.state)],
          command: ({ editor: current, range, props: item }) => {
            recents.remember(item.id)
            runSlashItem({ view: current.view, range, item, request: options.request, pick })
          },
          render: () => ({
            onStart: show,
            onUpdate: show,
            onKeyDown: ({ event }) => store.handleKey(event.key),
            onExit: () => {
              store.closeMenu()
            },
          }),
        }),
      ]
    },
  })
}
