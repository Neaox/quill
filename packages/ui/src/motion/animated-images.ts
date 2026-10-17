/**
 * How animated images play for the person reading (ADR-047, "Animation:
 * brief, stoppable, and never for those who ask for none").
 *
 * The person's preference is stored with their settings on the server; this
 * module is the page-side contract every surface agrees on. The effective
 * preference is an attribute on the document element, which the image
 * enhancer reads, and the same value is mirrored into storage under a key the
 * public site's script restates (`apps/server/src/public-site/scheme-script.ts`,
 * since the server may not import this package), so a member's choice follows
 * them onto their organisation's public site on the same origin.
 *
 * Whatever the preference, a person whose system asks for reduced motion
 * always sees a still: that is the enhancer's rule, not a fourth value here.
 */
export type AnimatedImagesPreference = 'brief' | 'hover' | 'never'

export const ANIMATED_IMAGES_PREFERENCES: readonly AnimatedImagesPreference[] = [
  'brief',
  'hover',
  'never',
]

/** The attribute on the document element. Absent means `brief`. */
export const ANIMATED_IMAGES_ATTRIBUTE = 'data-animated-images'

/** Where the preference is mirrored for the public site. */
export const ANIMATED_IMAGES_STORAGE_KEY = 'animated-images-preference'

/** What `brief` is: the default for anybody who has not chosen. */
export const DEFAULT_ANIMATED_IMAGES_PREFERENCE: AnimatedImagesPreference = 'brief'

export function isAnimatedImagesPreference(value: unknown): value is AnimatedImagesPreference {
  return ANIMATED_IMAGES_PREFERENCES.some((preference) => preference === value)
}

/** Writes the preference onto an element, usually `document.documentElement`. */
export function applyAnimatedImagesPreference(
  element: Element,
  preference: AnimatedImagesPreference,
): void {
  element.setAttribute(ANIMATED_IMAGES_ATTRIBUTE, preference)
}

/** The preference an element carries, `brief` when it carries none this release knows. */
export function readAnimatedImagesPreference(element: Element): AnimatedImagesPreference {
  const value = element.getAttribute(ANIMATED_IMAGES_ATTRIBUTE)
  return isAnimatedImagesPreference(value) ? value : DEFAULT_ANIMATED_IMAGES_PREFERENCE
}

/** The subset of `Storage` the mirror needs. */
export interface AnimatedImagesStorage {
  setItem(key: string, value: string): void
}

/**
 * Mirrors the preference for the public site. Storage throws rather than
 * failing quietly in a browser that blocks site data — reaching
 * `localStorage` at all can throw — so the storage is asked for inside the
 * guard, and a preference that cannot be remembered still applies to this
 * page.
 */
export function rememberAnimatedImagesPreference(
  preference: AnimatedImagesPreference,
  storage: () => AnimatedImagesStorage = () => globalThis.localStorage,
): void {
  try {
    storage().setItem(ANIMATED_IMAGES_STORAGE_KEY, preference)
  } catch {
    // Nothing to do: the attribute already applies it here.
  }
}
