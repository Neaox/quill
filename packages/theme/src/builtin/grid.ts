import type { ThemeDocument } from '../schema/theme-document.ts'

/**
 * Grid: the lockstay documentation portal's own look, made precise. Raised
 * white surfaces on a cool page, hairlines that draw every edge, one quiet
 * teal, Figtree for everything a reader sees, and whitespace rather than
 * ornament between sections. A documentation site moved onto Quill should be
 * able to look like the site it came from, and this is the first such site
 * (ADR-028's amendments of 11 October 2026; the research is
 * `docs/research/2026-10-11-documentation-design-survey.md`, Theme C).
 *
 * Where the survey's Grid and lockstay disagree, lockstay wins, because the
 * theme exists to be that look: Figtree rather than Geist (no new face to
 * ship, and Figtree is what makes lockstay read as lockstay), a cool tinted
 * neutral rather than zero-chroma greys (lockstay's page is
 * `oklch(97.2% 0.005 200)`, and a grey page loses the calm), and a teal
 * accent rather than signal orange. What Grid takes from the survey is the
 * precision: the hairline sits a step firmer than lockstay's rule so every
 * card and table edge is drawn rather than implied, the reading setting is
 * lockstay's exact 15 px on 24 px over a 736 px column, and the accent is
 * kept to the places the survey allows it (the current item's wash, the
 * active entry, focus, the one primary action).
 *
 * All of it is seeds, so every lever keeps working on a fork. lockstay's
 * accent, `oklch(43% 0.08 190)`, is outside sRGB, where a browser clips it to
 * about C 0.074, under the doctor's accent floor of C 0.08, so the seed sits
 * at L 47, the darkest teal sRGB can show at C 0.08, and dark mode starts at
 * L 78 as lockstay does. Text comes in lockstay's three inks: ink for headings
 * and emphasis, a softer body ink for running text, muted for metadata.
 *
 * Where the doctor's bands and lockstay disagree, the band wins and the value
 * is the nearest one inside it: the dark paper, surface and raised steps are
 * a touch further apart than lockstay's so each surface reads as one, and
 * dark ink stops at L 95.
 *
 * The radius is step 3 of the shared scale, which lands on lockstay's own
 * sizes within a pixel: 6 px for inline code and navigation items, 9 px for
 * code blocks and controls, 12 px for tables and cards.
 */
export const grid: ThemeDocument = {
  id: 'grid',
  name: 'Grid',
  seeds: {
    tone: {
      hue: 215,
      chroma: 0.008,
      steps: {
        light: { paper: 97.2, surface: 94, raised: 100, border: 90, muted: 52, body: 38, ink: 22 },
        dark: { paper: 19, surface: 21.5, raised: 23, border: 29, muted: 69, body: 83, ink: 95 },
      },
    },
    accent: { hue: 190, chroma: 0.085, lightness: 47, darkLightness: 78 },
  },
  type: {
    display: { source: 'curated', id: 'figtree' },
    reading: { source: 'curated', id: 'figtree' },
    interface: { source: 'curated', id: 'figtree' },
    mono: { source: 'curated', id: 'jetbrains-mono' },
    scale: {
      size: 15,
      leading: 1.6,
      measure: 46,
      lede: { size: 17, lineHeight: 27.2 },
      h1: { size: 34, lineHeight: 40, weight: 700, tracking: -0.02 },
      h2: { size: 21, lineHeight: 27, weight: 650, tracking: -0.005 },
      h3: { size: 17, lineHeight: 23, weight: 600 },
      h4: { size: 15, lineHeight: 21, weight: 600 },
      space: { h2: 48, h3: 28 },
      // lockstay's portal, measured: 14px between paragraphs, 10px under a
      // heading, 16px under the title, 22px above a figure and 28px below.
      flow: { block: 14, afterHeading: 10, afterTitle: 16, objectBefore: 22, objectAfter: 28 },
      eyebrow: { size: 13, weight: 600, tracking: 0.08 },
      table: { size: 13.5, leading: 1.45 },
      code: { size: 13 },
    },
    links: { text: 'accent', underline: 'current', thickness: 1, hoverThickness: 2, offset: 3 },
  },
  variants: {
    comments: 'panel',
    history: 'menu',
    navigation: 'tree',
    header: 'breadcrumb',
    rules: 'plain',
    align: 'start',
  },
  shape: { radiusStep: 3, density: 'comfortable' },
  levers: ['accent', 'tone', 'logo', 'radius', 'density', 'reading-face'],
  overrides: {
    shared: { '--radius-md': '0.625rem' },
    light: { '--palette-accent-subtle': 'oklch(96% 0.03 190)' },
    dark: { '--palette-accent-subtle': 'oklch(30% 0.05 190)' },
  },
}
