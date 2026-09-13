/**
 * The web app's one reading of the wall clock.
 *
 * Everything else that needs "now" in the browser asks for it here, so the
 * seam exists in one place — the same shape `packages/editor/src/drafts/clock.ts`
 * gives the editor — rather than `Date.now()` appearing in a component, where
 * it is both untestable and a value that changes under React between two
 * renders of the same state.
 *
 * A component captures it once (`useState(now)`) for a question that should
 * not tick while a person looks at it, or calls it in the event handler that
 * needs it. It is never called in a render body.
 */
export function now(): number {
  return Date.now()
}
