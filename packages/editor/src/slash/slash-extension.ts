import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { Suggestion } from '@tiptap/suggestion'
import type { SuggestionProps } from '@tiptap/suggestion'

import { filterSlashItems } from './slash-items.ts'
import type { SlashItem } from './slash-items.ts'
import type { SlashRect, SlashStore } from './slash-store.ts'

/**
 * `/` opens the insert menu (the plan document, section 17).
 *
 * The plugin owns when a query starts and where it ends; the store owns what the
 * author sees. Choosing an item deletes the typed query first, so the document
 * never keeps the command that made the block.
 */

export interface SlashMenuOptions {
  readonly store: SlashStore
  readonly items?: readonly SlashItem[]
  run(item: SlashItem, editor: Editor): void
}

/** The caret's box, when the browser can say where the caret is. */
export function rectOf(clientRect: SuggestionProps<SlashItem>['clientRect']): SlashRect | null {
  const rect = clientRect?.()
  return rect === null || rect === undefined
    ? null
    : { top: rect.top, bottom: rect.bottom, left: rect.left }
}

export function slashMenu(options: SlashMenuOptions): Extension {
  const show = (props: SuggestionProps<SlashItem>): void => {
    options.store.open({
      query: props.query,
      items: props.items,
      rect: rectOf(props.clientRect),
      apply: (item) => {
        props.command(item)
      },
    })
  }

  return Extension.create({
    name: 'slashMenu',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem>({
          editor: this.editor,
          char: '/',
          allowSpaces: false,
          items: ({ query }) => [...filterSlashItems(query, options.items)],
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run()
            options.run(props, editor)
          },
          render: () => ({
            onStart: show,
            onUpdate: show,
            onKeyDown: ({ event }) => options.store.handleKey(event.key),
            onExit: () => {
              options.store.close()
            },
          }),
        }),
      ]
    },
  })
}
