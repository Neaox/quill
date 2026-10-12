import type { CustomEmoji } from '@quill/markdown'
import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion } from '@tiptap/suggestion'
import type { SuggestionProps } from '@tiptap/suggestion'

import { insertShortcode } from '../slash/slash-commands.ts'
import { rectOf, triggerAllowed } from '../slash/slash-extension.ts'
import type { SlashItem } from '../slash/slash-item.ts'
import { rankMatches } from '../slash/slash-rank.ts'
import type { SlashRecents } from '../slash/slash-recents.ts'
import { runSlashItem } from '../slash/slash-run.ts'
import { slashSections } from '../slash/slash-sections.ts'
import type { SlashMenuWording, SlashStore } from '../slash/slash-store.ts'
import { emojiCatalogue } from './emoji-catalogue.ts'
import type { EmojiEntry } from './emoji-catalogue.ts'

/**
 * `:` and a few letters offers the emoji they could mean (ADR-038).
 *
 * The slash menu's machinery, asked a different question: the same trigger rule (the start of a
 * line or after whitespace, never in a word, an address or code), the same list the keyboard
 * drives, the same one-undo insertion. Only what is offered differs. The catalogue is the one the
 * `/emoji` picker reads, so the organisation's own emoji come first and GitHub's after, and a
 * choice writes the shortcode, which is what the Markdown keeps and what the editor and the reader
 * draw.
 *
 * It opens on the colon itself. A colon that starts a line or follows a space, with nothing after it
 * yet, is rarely prose: prose puts a colon after a word and a space after the colon, and a space is
 * what closes the menu again. So a writer who wants an emoji sees the organisation's own at once and
 * narrows them by typing, and one who meant only a colon loses nothing but a keystroke. Anything
 * that is not a name (`:)`, `:/`) closes it, a name that nothing matches offers nothing, and a closing
 * colon ends it: `:tada:` typed by hand is finished.
 */

/** What a name may be made of; the colon alone is the empty name. */
const QUERY = /^[a-z0-9_+-]*$/iu

/** The most the list shows: past a dozen, more letters are the better way to narrow it. */
const MENU_LIMIT = 12

export const EMOJI_WORDING: SlashMenuWording = {
  name: 'Emoji',
  empty: (query) => `No emoji match “${query}”`,
  count: (matches) => (matches === 0 ? 'No emoji' : `${String(matches)} emoji`),
}

/** An emoji as the menu lists it: its name, what it is, and its picture. Chosen, it writes its shortcode. */
function itemOf(entry: EmojiEntry): SlashItem {
  return {
    id: entry.name,
    label: entry.name,
    description: entry.description,
    group: 'Emoji',
    // Another name for it, or a word of what it is, finds it too: `thumbsup`, `party`.
    keywords: [...entry.names.slice(1), ...entry.description.split(' ')],
    ...('image' in entry ? { image: entry.image } : { glyph: entry.glyph }),
    inline: true,
    run: ({ state, dispatch }) => {
      insertShortcode(entry.name)(state, dispatch)
    },
  }
}

export interface EmojiSuggestionOptions {
  /** Shows the menu; the same one the slash key opens. */
  readonly store: SlashStore
  /** The organisation's own emoji (ADR-038). */
  readonly custom: ReadonlyMap<string, CustomEmoji>
  /** The emoji chosen last, offered first before anything is typed. */
  readonly recents: SlashRecents
}

export function emojiSuggestion({ store, custom, recents }: EmojiSuggestionOptions): Extension {
  // GitHub's list is a chunk of its own, so the items wait for it once, and the menu opens on the
  // first keystroke after it has arrived: a promise every keystroke reads, not a lookup each makes.
  const items = emojiCatalogue(custom).then((catalogue) => catalogue.map(itemOf))

  const show = (props: SuggestionProps<SlashItem>): void => {
    if (props.loading) return
    store.showMenu({
      wording: EMOJI_WORDING,
      query: props.query,
      sections: slashSections(props.query, props.items, recents.read()),
      rect: rectOf(props.clientRect),
      apply: (item) => {
        props.command(item)
      },
    })
  }

  return Extension.create({
    name: 'emojiSuggestion',
    // With the slash menu's, ahead of the core keymap: Enter and Tab choose while the menu is open.
    priority: 1100,
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem>({
          editor: this.editor,
          pluginKey: new PluginKey('emojiSuggestion'),
          char: ':',
          allowedPrefixes: null,
          allow: ({ state, range }) => triggerAllowed(state, range),
          items: async ({ query }) => {
            const all = await items
            const matches = rankMatches(query, all, { scattered: false }).map((match) => match.item)
            // Before anything is typed, what was chosen last leads, wherever it is in the list.
            const recent = query === '' ? recents.read() : []
            const lead = all.filter((item) => recent.includes(item.id))
            return [...new Set([...lead, ...matches])].slice(0, MENU_LIMIT)
          },
          shouldShow: ({ query }) => QUERY.test(query),
          command: ({ editor, range, props: item }) => {
            recents.remember(item.id)
            runSlashItem({
              view: editor.view,
              range,
              item,
              // An emoji asks the application for nothing and has no second step.
              /* v8 ignore start */
              request: () => undefined,
              pick: () => undefined,
              /* v8 ignore stop */
            })
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
