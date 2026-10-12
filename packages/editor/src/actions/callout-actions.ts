import { CALLOUT_TYPES } from '@quill/markdown'
import type { CalloutType } from '@quill/markdown'

import { calloutTitleOf, toggleCalloutTitle } from '../callout/callout-title.ts'
import {
  CALLOUT_PURPOSES,
  calloutAt,
  calloutLabel,
  deleteCallout,
  setCalloutType,
  unwrapCallout,
  wrapInCallout,
} from '../callout/callouts.ts'
import type { ActionGroup, ActionTone, EditorAction } from './editor-action.ts'

/**
 * The callout actions: which variant it is, and whether it is there at all.
 *
 * The variants are `CALLOUT_TYPES` from the Markdown package, so a variant added
 * to the directive is offered here the moment it exists.
 */

/** The tone each variant is drawn in on the page (`prose.css`), as a swatch. */
export const CALLOUT_TONES: Readonly<Record<CalloutType, ActionTone>> = {
  note: 'neutral',
  info: 'accent',
  tip: 'success',
  important: 'accent',
  warning: 'warning',
  caution: 'danger',
}

export const CALLOUT_VARIANT_GROUP: ActionGroup = {
  id: 'callout-variant',
  label: 'Callout type',
  actions: CALLOUT_TYPES.map((type) => ({
    id: `callout-${type}`,
    label: calloutLabel(type),
    description: CALLOUT_PURPOSES[type],
    kind: 'radio',
    tone: CALLOUT_TONES[type],
    command: setCalloutType(type),
    isChecked: (state) => calloutAt(state)?.type === type,
  })),
}

/** Whether the callout has a heading of its own, which this adds, and takes away again. */
export const CALLOUT_TITLE: EditorAction = {
  id: 'callout-title',
  label: 'Title',
  description: 'A heading of your own, in place of the type’s name',
  kind: 'check',
  command: toggleCalloutTitle,
  isChecked: (state) => {
    const callout = calloutAt(state)
    return callout !== null && calloutTitleOf(callout.node) !== undefined
  },
}

export const CALLOUT_REMOVE_GROUP: ActionGroup = {
  id: 'callout-remove',
  label: 'Callout',
  actions: [
    {
      id: 'callout-unwrap',
      label: 'Remove callout, keep the text',
      command: unwrapCallout,
    },
    { id: 'callout-delete', label: 'Delete callout', destructive: true, command: deleteCallout },
  ],
}

/** Everything about the callout the selection is in that the menu offers beside its type. */
export const CALLOUT_GROUP: ActionGroup = {
  id: 'callout',
  label: 'Callout',
  actions: [CALLOUT_TITLE, ...CALLOUT_REMOVE_GROUP.actions],
}

/** Turns the blocks the selection covers into a callout, for a selection that is in none. */
export const CALLOUT_WRAP_GROUP: ActionGroup = {
  id: 'callout-wrap',
  label: 'Put in a callout',
  actions: CALLOUT_TYPES.map((type) => ({
    id: `wrap-callout-${type}`,
    label: calloutLabel(type),
    description: CALLOUT_PURPOSES[type],
    tone: CALLOUT_TONES[type],
    command: wrapInCallout(type),
  })),
}
