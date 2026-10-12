import { useEffect } from 'react'

import { applyAnimatedImagesPreference, rememberAnimatedImagesPreference } from '@quill/ui'

import { usePersonPreferences } from '../../lib/api/index.ts'

/**
 * Puts the person's "Animated images" preference on the page (ADR-047), for
 * the image enhancer to read: `data-animated-images` on the document element,
 * and the same value mirrored into storage so the organisation's public site
 * on the same origin plays images the way this person asked
 * (`@quill/ui`'s `motion/animated-images.ts` is the contract).
 *
 * The document element and storage are external systems React does not
 * render, which is what the effect is for; it never sets state. Until the
 * preference has loaded nothing is written, and an absent attribute already
 * means the default.
 */
export function useAnimatedImagesPreference(): void {
  const preference = usePersonPreferences().data?.animatedImages

  // Synchronises the document element and localStorage, external systems
  // React does not render, with the person's stored preference.
  useEffect(() => {
    if (preference === undefined) return
    applyAnimatedImagesPreference(document.documentElement, preference)
    rememberAnimatedImagesPreference(preference)
  }, [preference])
}
