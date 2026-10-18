import {
  BadgeIcon,
  BoldIcon,
  ClearFormattingIcon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  SmallPrintIcon,
  StrikeIcon,
} from '@quill/ui'
import type { IconProps } from '@quill/ui'
import type { Command, EditorState } from '@tiptap/pm/state'
import type { ComponentType } from 'react'

import {
  clearFormatting,
  directiveActive,
  hasFormatting,
  markActive,
  toggleFormatDirective,
  toggleFormatMark,
} from './format-commands.ts'
import type { ShortcutName } from './shortcuts.ts'

/**
 * The formatting a writer reaches for, as data: what it is called, its icon,
 * its shortcut, whether it is on, and what it does. The selection toolbar
 * draws these as buttons and the context menu as entries, so the two never
 * disagree about a name or a shortcut.
 */

export interface FormatAction {
  readonly id: string
  readonly label: string
  readonly icon: ComponentType<IconProps>
  readonly shortcut?: ShortcutName
  /** Whether the selection already has it: the button's pressed state. */
  active(state: EditorState): boolean
  /** Undefined for the link, which opens the link popover instead of running a command. */
  readonly command: Command | undefined
}

/** The link, which opens the link popover rather than toggling. */
export const LINK_ACTION: FormatAction = {
  id: 'link',
  label: 'Link',
  icon: LinkIcon,
  shortcut: 'link',
  active: (state) => markActive(state, 'link'),
  command: undefined,
}

/** Marks and wrappers that toggle, and the link, in the order the toolbar shows them. */
export const FORMAT_ACTIONS: readonly FormatAction[] = [
  {
    id: 'bold',
    label: 'Bold',
    icon: BoldIcon,
    shortcut: 'bold',
    active: (state) => markActive(state, 'bold'),
    command: toggleFormatMark('bold'),
  },
  {
    id: 'italic',
    label: 'Italic',
    icon: ItalicIcon,
    shortcut: 'italic',
    active: (state) => markActive(state, 'italic'),
    command: toggleFormatMark('italic'),
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    icon: StrikeIcon,
    shortcut: 'strike',
    active: (state) => markActive(state, 'strike'),
    command: toggleFormatMark('strike'),
  },
  {
    id: 'code',
    label: 'Inline code',
    icon: InlineCodeIcon,
    shortcut: 'code',
    active: (state) => markActive(state, 'code'),
    command: toggleFormatMark('code'),
  },
  LINK_ACTION,
  {
    id: 'small',
    label: 'Small print',
    icon: SmallPrintIcon,
    active: (state) => directiveActive(state, 'small'),
    command: toggleFormatDirective('small'),
  },
  {
    id: 'badge',
    label: 'Badge',
    icon: BadgeIcon,
    active: (state) => directiveActive(state, 'badge'),
    command: toggleFormatDirective('badge'),
  },
]

export const CLEAR_FORMATTING: FormatAction = {
  id: 'clear',
  label: 'Clear formatting',
  icon: ClearFormattingIcon,
  shortcut: 'clearFormatting',
  active: () => false,
  command: clearFormatting,
}

/** Why a formatting action cannot apply to the selection now, or undefined when it can. */
export function formatUnavailable(action: FormatAction, state: EditorState): string | undefined {
  if (action.id === 'clear') {
    return hasFormatting(state) ? undefined : 'Nothing selected is formatted'
  }
  // The link popover links the selection, or inserts a link with words of its own.
  if (action.command === undefined) return undefined
  return action.command(state) ? undefined : 'Not available here'
}
