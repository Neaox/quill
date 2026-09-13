import type { ThemeDocument } from '../schema/theme-document.ts'

/**
 * Press, from `docs/design/canvas/Press.dc.html`: warm paper, an oxblood
 * accent, a serif that sets both the display and the reading surface,
 * sidenotes down the margin, and double rules under every heading.
 *
 * The seeds are the artboard's own values. Its paper is `oklch(98% 0.008 85)`
 * and its accent `oklch(42% 0.12 25)`.
 */
export const press: ThemeDocument = {
  id: 'press',
  name: 'Press',
  seeds: {
    tone: { hue: 85, chroma: 0.008 },
    accent: { hue: 25, chroma: 0.12, lightness: 42 },
  },
  type: {
    display: { source: 'curated', id: 'newsreader' },
    reading: { source: 'curated', id: 'newsreader' },
    interface: { source: 'curated', id: 'instrument-sans' },
    mono: { source: 'curated', id: 'jetbrains-mono' },
  },
  variants: {
    comments: 'sidenotes',
    history: 'menu',
    navigation: 'tree',
    header: 'breadcrumb',
    rules: 'double',
  },
  shape: { radiusStep: 1, density: 'comfortable' },
  levers: ['accent', 'reading-face', 'tone', 'logo', 'radius', 'density'],
}
