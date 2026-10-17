import type { Command, EditorState } from '@tiptap/pm/state'

import { linkTargetAt, setLinkChoice, showLinkAs } from '../link/link-display.ts'
import type { LinkDisplay } from '@quill/markdown'
import type { ActionGroup, EditorAction } from './editor-action.ts'

/**
 * How the link under the caret is shown, and what a card is made of
 * (ADR-042, "Authoring surface").
 *
 * The same actions are the toolbar's segmented control, the context menu's
 * "Show link as", and the command palette's entries, because an action is data
 * (`editor-action.ts`) and every surface is a rendering of a list of them.
 * `embed` is not offered: it needs the embed allowlist, which does not exist
 * yet, and an option that cannot work is not an option (ADR-042).
 */

const DISPLAY_LABELS = {
  url: 'Link',
  inline: 'Inline',
  compact: 'Compact',
  card: 'Card',
} as const satisfies Partial<Record<LinkDisplay, string>>

const DISPLAY_DESCRIPTIONS = {
  url: 'The address or your own words, with no preview',
  inline: 'The page’s icon and title, in the line',
  compact: 'Icon, title and site on one line, for lists of references',
  card: 'Title, summary and picture, on a line of its own',
} as const satisfies Partial<Record<LinkDisplay, string>>

/** A card is a block, so inside a line that cannot be split (a heading, a table cell, a placeholder) it cannot go. */
function blockUnavailableBecause(state: EditorState): string | undefined {
  return linkTargetAt(state) !== null && !showLinkAs('card')(state)
    ? NO_LINE_OF_ITS_OWN
    : undefined
}

/** The displays an author can choose for a link, in the order they are offered, with their words. */
export const LINK_DISPLAY_CHOICES = (
  ['url', 'inline', 'compact', 'card'] as const satisfies readonly (keyof typeof DISPLAY_LABELS)[]
).map((display) => ({
  display,
  label: DISPLAY_LABELS[display],
  description: DISPLAY_DESCRIPTIONS[display],
}))

export type LinkDisplayChoice = (typeof LINK_DISPLAY_CHOICES)[number]['display']

/** Why a card or a compact line cannot go where the selection is; the one sentence every surface uses. */
export const NO_LINE_OF_ITS_OWN =
  'A card or compact link needs a line of its own, which this place cannot give it'

export function linkDisplayAction(display: keyof typeof DISPLAY_LABELS): EditorAction {
  return {
    id: `link-show-${display}`,
    label: DISPLAY_LABELS[display],
    description: DISPLAY_DESCRIPTIONS[display],
    kind: 'radio',
    command: showLinkAs(display),
    isChecked: (state) => linkTargetAt(state)?.display === display,
    ...(display === 'card' || display === 'compact'
      ? { whyUnavailable: blockUnavailableBecause }
      : {}),
  }
}

export const LINK_DISPLAY_GROUP: ActionGroup = {
  id: 'link-display',
  label: 'Show link as',
  actions: [
    linkDisplayAction('url'),
    linkDisplayAction('inline'),
    linkDisplayAction('compact'),
    linkDisplayAction('card'),
  ],
}

/** The link under the caret when it is shown as a card, whose choices these are. */
function cardAt(state: EditorState) {
  const target = linkTargetAt(state)
  return target !== null && target.form === 'leaf' && target.display === 'card' ? target : null
}

/** A command that is only available when the link under the caret is shown as a card. */
function onCard(command: Command): Command {
  return (state, dispatch) => cardAt(state) !== null && command(state, dispatch)
}

function layoutAction(layout: 'side' | 'top', label: string, description: string): EditorAction {
  return {
    id: `card-layout-${layout}`,
    label,
    description,
    kind: 'radio',
    command: onCard(setLinkChoice({ layout })),
    isChecked: (state) => cardAt(state)?.link.choice.layout === layout,
  }
}

export const CARD_LAYOUT_GROUP: ActionGroup = {
  id: 'card-layout',
  label: 'Card layout',
  actions: [
    layoutAction('side', 'Image beside', 'Compact: the picture sits beside the words'),
    layoutAction('top', 'Image above', 'A large picture above the words'),
  ],
}

/**
 * Opens the box a card's own title and description are typed into. Typing is a
 * conversation with the author and not a change to the document, so, as with the
 * link box, the action only tells the interface to open it.
 */
export function cardDetailsAction(ui: { openDetails(): void }): EditorAction {
  return {
    id: 'card-details',
    label: 'Preview details…',
    description: 'Replace the title and description the page gives',
    command: (state, dispatch) => {
      if (cardAt(state) === null) return false
      if (dispatch !== undefined) ui.openDetails()
      return true
    },
  }
}

/** Whether the card shows the page's picture, which an author may drop. */
export const CARD_IMAGE: EditorAction = {
  id: 'card-image',
  label: 'Image',
  description: 'Show the page’s picture on the card',
  kind: 'check',
  command: (state, dispatch) => {
    const card = cardAt(state)
    return (
      card !== null && setLinkChoice({ showImage: !card.link.choice.showImage })(state, dispatch)
    )
  },
  isChecked: (state) => cardAt(state)?.link.choice.showImage === true,
}
