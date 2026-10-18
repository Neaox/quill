import { BRAND } from '@quill/brand'

import { useRememberedChoice } from '../../lib/storage/use-remembered-choice.ts'

/** The two answers to "Show link previews on hover", in the order a control offers them. */
export const LINK_PEEK_CHOICES = ['on', 'off'] as const
export type LinkPeekChoice = (typeof LINK_PEEK_CHOICES)[number]

const STORAGE_KEY = `${BRAND.slug}.link-peek`

/**
 * Whether a link in a document shows a small preview of its page while the
 * pointer rests on it (ADR-042, "Hover and focus peek").
 *
 * It is a reading preference of this browser, on by default: a laptop that is
 * plugged into a projector wants it off where a phone has no hover to give it.
 */
export function useLinkPeekPreference() {
  return useRememberedChoice<LinkPeekChoice>(STORAGE_KEY, LINK_PEEK_CHOICES, 'on')
}
