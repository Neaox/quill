import type { Command, EditorState } from '@tiptap/pm/state'

import type { LinkDisplay } from '@quill/markdown'

import { linkTargetAt, setLinkChoice, showLinkAs } from './link-display.ts'
import { embedHintFor } from './link-embeds.ts'

/**
 * How the link under the caret is shown, and what a card is made of
 * (ADR-042, "Authoring surface").
 *
 * The same actions are the link card's and the link popover's "Show as", the
 * pasted-link offer, the context menu's "Show link as", and the command
 * palette's entries, because an action is data and every surface is a
 * rendering of a list of them.
 * `embed` is always listed and available only for an address whose preview has a
 * frame from the embed allowlist (`link-embeds.ts`); anywhere else it is disabled
 * and says why, as a card does where the line cannot be split.
 */

/** One thing an author can do to how a link is shown, described once. */
export interface LinkAction {
  readonly id: string
  readonly label: string
  /** A sentence of what it does, for a surface that has room for one. */
  readonly description?: string
  /** A plain item, one of a set of choices, or an on/off switch. */
  readonly kind?: 'item' | 'radio' | 'check'
  /** Run without a dispatch, it answers whether it would do anything here. */
  readonly command: Command
  /**
   * Why the action is not available here, when it is not: shown on the disabled control, because
   * a control that is greyed out with no reason reads as broken.
   */
  whyUnavailable?(state: EditorState): string | undefined
  /** For `radio` and `check` actions: whether the choice is the current one. */
  isChecked?(state: EditorState): boolean
}

export interface LinkActionGroup {
  readonly id: string
  readonly label: string
  readonly actions: readonly LinkAction[]
}

export interface LinkActionState {
  readonly enabled: boolean
  readonly checked: boolean
}

export function linkActionState(action: LinkAction, state: EditorState): LinkActionState {
  const checked = action.isChecked?.(state) ?? false
  // The choice already in force is not "unavailable" because choosing it again
  // would change nothing: a control that greyed it out would read as broken.
  return { enabled: checked || action.command(state), checked }
}

/** Why an action cannot be used here, or undefined when it can (`docs/design/feedback.md`). */
export function linkActionUnavailable(action: LinkAction, state: EditorState): string | undefined {
  if (linkActionState(action, state).enabled) return undefined
  return action.whyUnavailable?.(state) ?? 'Not available here'
}

const DISPLAY_LABELS = {
  url: 'Link',
  inline: 'Inline',
  compact: 'Compact',
  card: 'Card',
  embed: 'Embed',
} as const satisfies Partial<Record<LinkDisplay, string>>

const DISPLAY_DESCRIPTIONS = {
  url: 'The address or your own words, with no preview',
  inline: 'The page’s icon and title, in the line',
  compact: 'Icon, title and site on one line, for lists of references',
  card: 'Title, summary and picture, on a line of its own',
  embed: 'The page itself, live, in a frame (YouTube, Figma and other supported sites)',
} as const satisfies Partial<Record<LinkDisplay, string>>

/** A card is a block, so inside a line that cannot be split (a heading, a table cell, a placeholder) it cannot go. */
function blockUnavailableBecause(state: EditorState): string | undefined {
  return linkTargetAt(state) !== null && !showLinkAs('card')(state) ? NO_LINE_OF_ITS_OWN : undefined
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

/** Why a page cannot be embedded; the one sentence every surface uses. */
export const NOT_EMBEDDABLE =
  'This page cannot be embedded: only pages from supported sites, such as YouTube, Vimeo and Figma, can, and the organisation’s link settings must allow rich previews'

/** An embed is a block like a card, and also needs a page that can be embedded at all. */
function embedUnavailableBecause(state: EditorState): string | undefined {
  const target = linkTargetAt(state)
  if (target === null) return undefined
  if (embedHintFor(state, target.href) === undefined) return NOT_EMBEDDABLE
  return blockUnavailableBecause(state)
}

export function linkDisplayAction(display: keyof typeof DISPLAY_LABELS): LinkAction {
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
    ...(display === 'embed' ? { whyUnavailable: embedUnavailableBecause } : {}),
  }
}

export const LINK_DISPLAY_GROUP: LinkActionGroup = {
  id: 'link-display',
  label: 'Show link as',
  actions: [
    linkDisplayAction('url'),
    linkDisplayAction('inline'),
    linkDisplayAction('compact'),
    linkDisplayAction('card'),
    linkDisplayAction('embed'),
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

function layoutAction(layout: 'side' | 'top', label: string, description: string): LinkAction {
  return {
    id: `card-layout-${layout}`,
    label,
    description,
    kind: 'radio',
    command: onCard(setLinkChoice({ layout })),
    isChecked: (state) => cardAt(state)?.link.choice.layout === layout,
  }
}

/** The layouts, each with the short word a control uses where room is short; the action's label is the full one. */
export const CARD_LAYOUT_CHOICES = [
  {
    action: layoutAction('side', 'Image beside', 'Compact: the picture sits beside the words'),
    shortWord: 'Beside',
  },
  {
    action: layoutAction('top', 'Image above', 'A large picture above the words'),
    shortWord: 'Above',
  },
] as const

export const CARD_LAYOUT_GROUP: LinkActionGroup = {
  id: 'card-layout',
  label: 'Card layout',
  actions: CARD_LAYOUT_CHOICES.map(({ action }) => action),
}

/**
 * Opens the box a card's own title and description are typed into. Typing is a
 * conversation with the author and not a change to the document, so, as with the
 * link box, the action only tells the interface to open it.
 */
export function cardDetailsAction(ui: { openDetails(): void }): LinkAction {
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
export const CARD_IMAGE: LinkAction = {
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
