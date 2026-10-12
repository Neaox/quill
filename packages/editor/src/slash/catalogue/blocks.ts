import { CALLOUT_TYPES, LAYOUT_WIDTHS } from '@quill/markdown'
import type { CalloutType, LayoutWidth } from '@quill/markdown'
import {
  CalloutIcon,
  CardsIcon,
  DangerIcon,
  FigureIcon,
  InfoIcon,
  NotesIcon,
  SuccessIcon,
  WarningIcon,
  WidthIcon,
} from '@quill/ui'
import type { IconProps } from '@quill/ui'
import type { ComponentType } from 'react'

import { setBlockWidth } from '../../block/commands.ts'
import { nodeType } from '../../schema/node-type.ts'
import { calloutBlock, containerDirective, insertBlock, paragraph } from '../slash-commands.ts'
import { commandItem } from '../slash-item.ts'
import type { SlashContribution, SlashItem } from '../slash-item.ts'

/**
 * Blocks: the directives that hold other blocks (ADR-036) and the widths a
 * block reads at (ADR-027). Each container opens with the caret inside it.
 */

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

const CALLOUT_DESCRIPTIONS: Readonly<Record<CalloutType, string>> = {
  note: 'An aside the reader should notice',
  info: 'Background the reader may want',
  tip: 'A better way to do something',
  important: 'Something the reader must not miss',
  warning: 'Something that could go wrong',
  caution: 'Something with consequences',
}

/** Each tone's own mark, so six callouts are told apart at a glance and not by their labels alone. */
const CALLOUT_ICONS: Readonly<Record<CalloutType, ComponentType<IconProps>>> = {
  note: CalloutIcon,
  info: InfoIcon,
  tip: SuccessIcon,
  important: CalloutIcon,
  warning: WarningIcon,
  caution: DangerIcon,
}

function calloutItem(type: CalloutType): SlashItem {
  return commandItem(
    {
      id: `callout-${type}`,
      label: `Callout: ${capitalise(type)}`,
      description: CALLOUT_DESCRIPTIONS[type],
      group: 'Blocks',
      keywords: ['callout', 'aside', 'alert', type],
      aliases: ['admonition'],
      icon: CALLOUT_ICONS[type],
    },
    insertBlock(calloutBlock(type)),
  )
}

function widthItem(width: LayoutWidth): SlashItem {
  return commandItem(
    {
      id: `width-${width}`,
      label: `Width: ${capitalise(width)}`,
      description: `Lay this block out at the ${width} width`,
      group: 'Blocks',
      keywords: ['width', 'layout', 'breakout', width],
      icon: WidthIcon,
    },
    setBlockWidth(width),
  )
}

export const blockItems: SlashContribution = {
  id: 'core.blocks',
  items: () => [
    ...CALLOUT_TYPES.map(calloutItem),
    commandItem(
      {
        id: 'figure',
        label: 'Figure with caption',
        description: 'A block and the words that caption it',
        group: 'Blocks',
        keywords: ['figure', 'caption', 'figcaption'],
        icon: FigureIcon,
      },
      insertBlock(
        containerDirective('figure', {}, (schema) => [
          paragraph(schema),
          paragraph(schema, 'Caption'),
        ]),
      ),
    ),
    commandItem(
      {
        id: 'cards',
        label: 'Cards',
        description: 'Short sections side by side',
        group: 'Blocks',
        keywords: ['cards', 'columns', 'grid', 'panels'],
        icon: CardsIcon,
      },
      insertBlock(
        containerDirective('cards', {}, (schema) => {
          const heading = (text: string) =>
            nodeType(schema, 'heading').create({ level: 3 }, schema.text(text))
          return [
            heading('First card'),
            paragraph(schema),
            heading('Second card'),
            paragraph(schema),
          ]
        }),
        { selectText: true },
      ),
    ),
    commandItem(
      {
        id: 'notes',
        label: 'Presenter notes',
        description: 'What to say when presenting; never shown to readers',
        group: 'Blocks',
        keywords: ['notes', 'speaker', 'present', 'slides'],
        icon: NotesIcon,
      },
      insertBlock(containerDirective('notes', {})),
    ),
    ...LAYOUT_WIDTHS.map(widthItem),
  ],
}
