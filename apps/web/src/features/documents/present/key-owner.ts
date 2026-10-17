/**
 * Whose a key is, in a presentation.
 *
 * The window listens for keys from a remote with nothing in particular focused, and steps on Space.
 * With a slide that can be used, something in it may have the focus, and then a key may be its own:
 * Space or Enter pressed on a button, a link or a picture is that control pressed, not the next
 * slide; and every key inside the viewer a picture opens in is the viewer's (Escape closes it, the
 * arrows pan the picture), not a step or a way out of the presentation.
 */

/** What Space and Enter press. */
const PRESSABLE =
  'button, a[href], summary, input, select, textarea, [role="button"], [contenteditable="true"]'

export function targetOwnsKey(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('dialog') !== null) return true
  return (key === ' ' || key === 'Enter') && target.closest(PRESSABLE) !== null
}
