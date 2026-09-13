import type { ThemeDocument } from '../schema/theme-document.ts'

/**
 * Atelier, from `docs/design/canvas/Atelier.dc.html`: warm paper again but
 * softer, a moss accent, Instrument Serif for display over Instrument Sans
 * for everything else, coloured collection tabs, and cards instead of rules.
 *
 * Its paper is `oklch(97.5% 0.012 90)` and its accent `oklch(42% 0.1 150)`.
 */
export const atelier: ThemeDocument = {
  id: 'atelier',
  name: 'Atelier',
  seeds: {
    tone: { hue: 90, chroma: 0.012 },
    accent: { hue: 150, chroma: 0.1, lightness: 42 },
  },
  type: {
    display: { source: 'curated', id: 'instrument-serif' },
    reading: { source: 'curated', id: 'instrument-sans' },
    interface: { source: 'curated', id: 'instrument-sans' },
    mono: { source: 'curated', id: 'jetbrains-mono' },
  },
  variants: {
    comments: 'panel',
    history: 'menu',
    navigation: 'tabs',
    header: 'breadcrumb',
    rules: 'cards',
  },
  shape: { radiusStep: 3, density: 'comfortable' },
  levers: ['accent', 'collection-colours', 'logo', 'tone', 'radius', 'reading-face'],
}
