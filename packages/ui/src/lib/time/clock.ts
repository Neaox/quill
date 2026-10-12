/**
 * The design system's one reading of the wall clock, so the seam exists in one place
 * (`apps/web/src/lib/time/clock.ts` is its twin) rather than `Date.now()` appearing in a
 * component, where it is untestable and changes under React between two renders.
 */
export function now(): number {
  return Date.now()
}
