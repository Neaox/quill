import { CALLOUT_TYPES } from '@quill/markdown'
import { CALLOUT_ICONS, CalloutIcon, PencilIcon, QuoteIcon } from '@quill/ui'
import { TextSelection } from '@tiptap/pm/state'

import type {
  ContextMenuContribution,
  MenuEntry,
  MenuPlace,
} from '../context-menu/context-menu-registry.ts'
import {
  CALLOUT_LABELS,
  calloutAt,
  calloutToQuote,
  quoteAt,
  quoteToCallout,
  setCalloutTitle,
  setCalloutType,
} from './callout.ts'
import type { CalloutRef } from './callout.ts'

/**
 * The callout's part of the context menu, and the whole of the switcher its
 * type button opens: the six types, a title of the callout's own, and turning
 * a callout into a plain quote and a quote into a callout. Every change is one
 * undo step and keeps the author's syntax (`callout.ts`): a quote stays a quote,
 * its marker in the case it was typed.
 */

/** The word put in as a new title, selected so typing replaces it. */
const NEW_TITLE = 'Title'

function addTitle(place: MenuPlace, callout: CalloutRef): void {
  const { view } = place
  setCalloutTitle(callout.pos, NEW_TITLE)(view.state, view.dispatch)
  const start = callout.pos + 2
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, start, start + NEW_TITLE.length),
    ),
  )
  view.focus()
}

function calloutEntries(place: MenuPlace, callout: CalloutRef): MenuEntry[] {
  const { view } = place
  const titled = callout.title !== undefined
  return [
    {
      kind: 'choice',
      id: 'callout-type',
      label: 'Callout type',
      value: callout.type,
      options: CALLOUT_TYPES.map((type) => ({
        value: type,
        label: CALLOUT_LABELS[type],
        icon: CALLOUT_ICONS[type],
      })),
      choose: (value) => {
        const type = CALLOUT_TYPES.find((each) => each === value)
        if (type !== undefined) setCalloutType(callout.pos, type)(view.state, view.dispatch)
        view.focus()
      },
    },
    {
      kind: 'action',
      id: titled ? 'remove-callout-title' : 'add-callout-title',
      label: titled ? 'Remove title' : 'Add title',
      icon: PencilIcon,
      run: () => {
        if (!titled) {
          addTitle(place, callout)
          return
        }
        setCalloutTitle(callout.pos, '')(view.state, view.dispatch)
        view.focus()
      },
    },
    {
      kind: 'action',
      id: 'callout-to-quote',
      label: 'Turn into a plain quote',
      icon: QuoteIcon,
      run: () => {
        calloutToQuote(callout.pos)(view.state, view.dispatch)
        view.focus()
      },
    },
  ]
}

export const calloutMenu: ContextMenuContribution = {
  id: 'callout',
  order: 40,
  label: 'Callout',
  entries: (place) => {
    const callout = calloutAt(place.state, place.pos)
    if (callout !== undefined) return calloutEntries(place, callout)
    const quote = quoteAt(place.state, place.pos)
    if (quote === undefined) return []
    const { view } = place
    return [
      {
        kind: 'action',
        id: 'quote-to-callout',
        label: 'Turn into a callout',
        icon: CalloutIcon,
        run: () => {
          quoteToCallout(quote)(view.state, view.dispatch)
          view.focus()
        },
      },
    ]
  },
}
