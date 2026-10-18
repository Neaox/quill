import { CopyIcon, ExternalIcon, PencilIcon, UnlinkIcon } from '@quill/ui'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import type {
  ContextMenuContribution,
  MenuEntry,
  MenuPlace,
} from '../context-menu/context-menu-registry.ts'
import { linkAt, unlink } from './link-commands.ts'
import {
  CARD_IMAGE,
  CARD_LAYOUT_GROUP,
  LINK_DISPLAY_GROUP,
  cardDetailsAction,
  linkActionState,
  linkActionUnavailable,
} from './link-display-actions.ts'
import type { LinkAction, LinkActionGroup } from './link-display-actions.ts'
import { linkTargetAt } from './link-display.ts'

/**
 * The context menu over a link: open it, edit it, copy where it goes, or take
 * it off; and how it is shown (ADR-042) — Link, Inline, Compact, Card, Embed —
 * with, for a card, its layout, its picture and its own words. A right-click
 * puts the caret in the link first, so the display choices act on it.
 */

function run(view: EditorView, action: LinkAction): void {
  action.command(view.state, view.dispatch, view)
  view.focus()
}

/** A group of choices as one menu choice, with each unavailable option saying why. */
function choiceOf(view: EditorView, state: EditorState, group: LinkActionGroup): MenuEntry {
  const current = group.actions.find((action) => linkActionState(action, state).checked)
  return {
    kind: 'choice',
    id: group.id,
    label: group.label,
    value: current?.id ?? '',
    options: group.actions.map((action) => ({
      value: action.id,
      label: action.label,
      disabledReason: linkActionUnavailable(action, state),
    })),
    choose: (value) => {
      const chosen = group.actions.find((action) => action.id === value)
      if (chosen !== undefined) run(view, chosen)
    },
  }
}

/** How the link at the caret is shown, and what its card is made of. */
function displayEntries({ view, state, editor }: MenuPlace): readonly MenuEntry[] {
  const target = linkTargetAt(state)
  if (target === null) return []
  const display = choiceOf(view, state, LINK_DISPLAY_GROUP)
  if (target.form !== 'leaf' || target.display !== 'card') return [display]
  const details = cardDetailsAction({
    openDetails: () => {
      editor.editLinkDetails(target.from)
    },
  })
  return [
    display,
    choiceOf(view, state, CARD_LAYOUT_GROUP),
    {
      kind: 'action',
      id: CARD_IMAGE.id,
      label: CARD_IMAGE.label,
      checked: linkActionState(CARD_IMAGE, state).checked,
      run: () => {
        run(view, CARD_IMAGE)
      },
    },
    {
      kind: 'action',
      id: details.id,
      label: details.label,
      run: () => {
        run(view, details)
      },
    },
  ]
}

/** Open, Edit, Copy and, for an ordinary link, Unlink. */
function linkEntries({ view, state, pos, environment, editor }: MenuPlace): readonly MenuEntry[] {
  const mark = linkAt(state, pos)
  const target = linkTargetAt(state)
  const href = mark?.href ?? (target?.form === 'mark' ? undefined : target?.href)
  if (href === undefined) return []
  const unlinkEntry: readonly MenuEntry[] =
    mark === undefined
      ? []
      : [
          {
            kind: 'action',
            id: 'unlink',
            label: 'Unlink',
            icon: UnlinkIcon,
            run: () => {
              unlink(mark.from, mark.to)(view.state, view.dispatch)
              view.focus()
            },
          },
        ]
  return [
    {
      kind: 'action',
      id: 'open-link',
      label: 'Open link',
      icon: ExternalIcon,
      disabledReason:
        environment.openLink === undefined ? 'Links cannot be opened here' : undefined,
      run: () => {
        environment.openLink?.(href)
      },
    },
    {
      kind: 'action',
      id: 'edit-link',
      label: 'Edit link',
      icon: PencilIcon,
      run: () => {
        editor.editLink()
      },
    },
    {
      kind: 'action',
      id: 'copy-link',
      label: 'Copy link address',
      icon: CopyIcon,
      disabledReason:
        environment.copyText === undefined ? 'The clipboard is not available here' : undefined,
      run: () => {
        void environment.copyText?.(href)
      },
    },
    ...unlinkEntry,
  ]
}

export const linkMenu: ContextMenuContribution = {
  id: 'link',
  order: 10,
  entries: (place) => [...linkEntries(place), ...displayEntries(place)],
}
