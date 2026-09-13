import type { ThemeDocument } from '../schema/theme-document.ts'

/**
 * Instrument, from `docs/design/canvas/Instrument.dc.html`: a cool-neutral
 * page, one international-orange signal, the Plex family throughout, a
 * revision timeline, a status readout instead of a breadcrumb, and hairlines.
 *
 * Its accent is `oklch(62% 0.2 45)`, a signal colour rather than a text
 * colour: the generator keeps that lightness for the mark and derives a
 * darker, contrast-safe variant for links and controls.
 */
export const instrument: ThemeDocument = {
  id: 'instrument',
  name: 'Instrument',
  seeds: {
    tone: { hue: 250, chroma: 0.008 },
    accent: { hue: 45, chroma: 0.2, lightness: 62 },
  },
  type: {
    display: { source: 'curated', id: 'ibm-plex-sans' },
    reading: { source: 'curated', id: 'ibm-plex-serif' },
    interface: { source: 'curated', id: 'ibm-plex-sans' },
    mono: { source: 'curated', id: 'ibm-plex-mono' },
  },
  variants: {
    comments: 'panel',
    history: 'timeline',
    navigation: 'tree',
    header: 'readout',
    rules: 'hairline',
  },
  shape: { radiusStep: 2, density: 'compact' },
  levers: ['accent', 'tone', 'logo', 'density', 'radius', 'reading-face'],
}
