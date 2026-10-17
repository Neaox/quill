import type { ThemeDocument } from '../schema/theme-document.ts'

/**
 * Calm: the quiet modern sans the survey recommends as the candidate default
 * (`docs/research/2026-10-11-documentation-design-survey.md`, Theme A). It is
 * what lockstay, Linear, Fumadocs and PlanetScale share: one sans carrying the
 * whole page, an interface a step smaller than the prose, three inks with a
 * job each, surfaces that differ by a percent or two of lightness, and an
 * indigo accent kept to the current item, the active entry, focus and the
 * one primary action.
 *
 * Inter carries the display, the reading surface and the interface;
 * JetBrains Mono carries code. Both were already in the curated set.
 *
 * The page is a near-white with a faint cool tint (`oklch(98.5% 0.0055 255)`)
 * and cards sit on pure white above it, so a card has somewhere to sit without
 * a shadow. The neutrals stay close to grey, at C 0.0055 — the least that
 * still reads as a tint once dark mode takes its quarter off — so the accent
 * is the only colour on the page. Text is in three steps: ink at L 22 for headings
 * and emphasis, body at L 40 for running text, muted at L 52 for metadata.
 * The dark scheme is a tinted charcoal, never black, so a raised surface can
 * step *up* from the page to show depth, and its ink stops at L 95 so body
 * text never haloes.
 *
 * The accent is hue 262 at C 0.15, Linear's indigo: L 53 in light, which
 * holds 4.5:1 for text on every surface and carries white text on a filled
 * control, and L 72 in dark.
 *
 * The reading setting is the survey's 16 px on 26 px over a 42 rem column
 * (about 68 characters of Inter), so the prose is a step larger than the
 * 14 px interface. Headings are small and confident — 32, 22, 17.5 px at
 * weights just above 600 with display tracking, Linear's ladder — and a
 * link keeps the ink and carries the accent in its underline. The radius is step 3: 6 px for small items, 9 px for
 * controls and code, 12 px for cards, tables and callouts.
 */
export const calm: ThemeDocument = {
  id: 'calm',
  name: 'Calm',
  seeds: {
    tone: {
      hue: 255,
      chroma: 0.0055,
      steps: {
        light: {
          paper: 98.5,
          surface: 96.5,
          raised: 100,
          border: 91.5,
          muted: 52,
          body: 40,
          ink: 22,
        },
        dark: { paper: 17, surface: 20, raised: 23.5, border: 30, muted: 68, body: 85, ink: 95 },
      },
    },
    accent: { hue: 262, chroma: 0.15, lightness: 53, darkLightness: 72 },
  },
  type: {
    display: { source: 'curated', id: 'inter' },
    reading: { source: 'curated', id: 'inter' },
    interface: { source: 'curated', id: 'inter' },
    mono: { source: 'curated', id: 'jetbrains-mono' },
    scale: {
      size: 16,
      leading: 1.625,
      measure: 42,
      lede: { size: 18, lineHeight: 28 },
      h1: { size: 32, lineHeight: 38, weight: 640, tracking: -0.022 },
      h2: { size: 22, lineHeight: 28, weight: 620, tracking: -0.012 },
      h3: { size: 17.5, lineHeight: 26, weight: 600, tracking: -0.006 },
      h4: { size: 15, lineHeight: 22, weight: 600 },
      space: { h2: 48, h3: 32 },
      eyebrow: { size: 12.5, weight: 600, tracking: 0.07 },
      table: { size: 14, leading: 1.45 },
      code: { size: 13.5 },
    },
    links: { text: 'ink', underline: 'accent', thickness: 1.25, hoverThickness: 2, offset: 3 },
  },
  variants: {
    comments: 'panel',
    history: 'menu',
    navigation: 'tree',
    header: 'breadcrumb',
    rules: 'plain',
  },
  shape: { radiusStep: 3, density: 'comfortable' },
  levers: ['accent', 'tone', 'logo', 'radius', 'density', 'reading-face'],
  /*
   * The current item's wash in dark: the generated tint is a mix into the
   * charcoal and comes out too faint to find at a glance, so it is set at the
   * top of the area budget instead (C 0.02) — the survey's `accent-wash`.
   */
  overrides: { dark: { '--palette-accent-subtle': 'oklch(27% 0.02 262)' } },
}
