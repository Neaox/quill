import { BADGE_SHORTHANDS } from '@quill/markdown'
import type { BadgeTone } from '@quill/markdown'
import { BadgeIcon, EmojiIcon, LabelIcon, TableIcon } from '@quill/ui'

import { emojiCatalogue } from '../../emoji/emoji-catalogue.ts'
import type { EmojiEntry } from '../../emoji/emoji-catalogue.ts'
import { createTable } from '../../schema/tables.ts'
import {
  insertBlock,
  insertInline,
  insertShortcode,
  insertText,
  textDirective,
} from '../slash-commands.ts'
import { commandItem, pickerItem } from '../slash-item.ts'
import type {
  SlashContribution,
  SlashEnvironment,
  SlashItem,
  SlashPickerOption,
  SlashPlace,
} from '../slash-item.ts'
import { rankMatches } from '../slash-rank.ts'

/**
 * Data: tables and the inline marks a table cell is made of — a status
 * badge (ADR-036), one of the organisation's labels (ADR-037), an emoji
 * (ADR-038). The inline ones are offered in table cells, where they are
 * used most.
 */

const TONE_NAMES: Readonly<Record<BadgeTone, string>> = {
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
  accent: 'Accent',
  neutral: 'Neutral',
}

const BADGE_OPTIONS: readonly SlashPickerOption[] = Object.entries(BADGE_SHORTHANDS).map(
  ([name, tone]) => ({
    id: name,
    label: TONE_NAMES[tone],
    description: `:${name}[…]`,
    keywords: [name, tone],
  }),
)

/** The most a picker lists at once; a longer list is narrowed by typing. */
const PICKER_LIMIT = 60

/** Whether an inline node may go at the caret, which any text directive answers for all of them. */
function inlineFits(place: SlashPlace): boolean {
  return insertInline(textDirective('badge', 'Status'))(place.state)
}

function labelItem(labels: readonly string[]): SlashItem {
  const options = labels.map((name) => ({ id: name, label: name, description: `:${name}[…]` }))
  return pickerItem(
    {
      id: 'label',
      label: 'Label',
      description: 'One of the organisation’s labels',
      group: 'Data',
      keywords: ['label', 'tag', 'channel'],
      icon: LabelIcon,
      inline: true,
    },
    {
      title: 'Label',
      placeholder: 'Search labels',
      empty: (query) => `No label matches “${query}”`,
      source: {
        kind: 'list',
        options: (query) => rankMatches(query, options).map(({ item }) => item),
      },
      choose: (option) =>
        insertInline(
          textDirective(option.id, option.id.charAt(0).toUpperCase() + option.id.slice(1)),
        ),
    },
    inlineFits,
  )
}

/** An emoji as the picker lists it: a custom one by its shortcode, a standard one by what it is. */
function pickerOption(entry: EmojiEntry): SlashPickerOption {
  const { name, names, description } = entry
  if ('image' in entry) return { id: name, label: `:${name}:`, description, image: entry.image }
  return {
    id: name,
    label: description.charAt(0).toUpperCase() + description.slice(1),
    description: names.map((other) => `:${other}:`).join(' '),
    keywords: names,
    glyph: entry.glyph,
  }
}

async function emojiOptions(
  environment: SlashEnvironment,
  query: string,
): Promise<readonly SlashPickerOption[]> {
  const catalogue = await emojiCatalogue(environment.customEmoji ?? new Map())
  return rankMatches(query, catalogue.map(pickerOption))
    .slice(0, PICKER_LIMIT)
    .map(({ item }) => item)
}

export const dataItems: SlashContribution = {
  id: 'core.data',
  items: (environment) => [
    commandItem(
      {
        id: 'table',
        label: 'Table',
        description: 'A table with a header row',
        group: 'Data',
        keywords: ['table', 'grid', 'rows', 'columns'],
        icon: TableIcon,
      },
      insertBlock((schema) => createTable(schema, 2, 3)),
    ),
    pickerItem(
      {
        id: 'badge',
        label: 'Status badge',
        description: 'A coloured pill such as Built or Blocked',
        group: 'Data',
        keywords: ['badge', 'status', 'pill', 'tone', 'ok', 'warn'],
        icon: BadgeIcon,
        inline: true,
      },
      {
        title: 'Badge tone',
        placeholder: 'Search tones',
        empty: (query) => `No tone matches “${query}”`,
        source: {
          kind: 'list',
          options: (query) => rankMatches(query, BADGE_OPTIONS).map(({ item }) => item),
        },
        choose: (option) => insertInline(textDirective(option.id, 'Status')),
      },
      inlineFits,
    ),
    ...(environment.labels === undefined || environment.labels.length === 0
      ? []
      : [labelItem(environment.labels)]),
    pickerItem(
      {
        id: 'emoji',
        label: 'Emoji',
        description: 'A GitHub emoji or one of your organisation’s',
        group: 'Data',
        keywords: ['emoji', 'smiley', 'icon', 'reaction'],
        icon: EmojiIcon,
        inline: true,
      },
      {
        title: 'Emoji',
        placeholder: 'Search emoji',
        empty: (query) => `No emoji matches “${query}”`,
        source: { kind: 'search', search: (query) => emojiOptions(environment, query) },
        choose: (option) => insertShortcode(option.id),
      },
      (place) => insertText(':')(place.state),
    ),
  ],
}
