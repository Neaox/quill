import type { ThemeDocument } from '../schema/theme-document.ts'

/**
 * Editorial: long-form reading — handbooks, essays, policy, public
 * publications (`docs/research/2026-10-11-documentation-design-survey.md`,
 * Theme B). Warm paper, a refined serif at book size, and the accent in the
 * reading column rather than the chrome. Its references are Increment, the
 * Claude Platform docs and Apple's abstracts. It supersedes Press, which was
 * the same idea at a lower finish: Press's id resolves here.
 *
 * Source Serif 4 sets the prose and the headings, with its optical-size axis,
 * so a heading gets the display cut and the body the text cut from the one
 * file. Inter sets the chrome, kept small, so the serif owns the column;
 * JetBrains Mono sets code. All three were already in the curated set.
 *
 * The paper is a warm off-white (`oklch(97.5% 0.008 70)`), never white, and
 * dark mode is a warm charcoal, never black. Body text is set strong, as in
 * print — L 30 against the ink's L 22 — because a serif at reading size wants
 * more weight than a sans; dark ink stops at L 93 so the column never haloes.
 *
 * The accent is an earthy rust at hue 35: a step warmer than Press's oxblood,
 * far enough from the danger hue that the status set never has to bend, and
 * analogous to the paper's warmth. It belongs to link underlines, the eyebrow,
 * the active table-of-contents entry and focus, never to the chrome.
 *
 * The reading setting is the survey's 18.5 px on 31 px over a 40 rem column,
 * about 66 characters of Source Serif, under a 22 px dek; headings are set at
 * 40, 27 and 21 px in the display cut at a book weight (560), not bold. The radius is step 2, quieter than
 * Calm: 4 px for small items, 6 px for code, 8 px for cards.
 */
export const editorial: ThemeDocument = {
  id: 'editorial',
  name: 'Editorial',
  seeds: {
    tone: {
      hue: 70,
      chroma: 0.008,
      steps: {
        light: {
          paper: 97.5,
          surface: 95.5,
          raised: 99,
          border: 90.5,
          muted: 51,
          body: 30,
          ink: 22,
        },
        dark: {
          paper: 18.5,
          surface: 21.5,
          raised: 25,
          border: 30.5,
          muted: 68,
          body: 86,
          ink: 93,
        },
      },
    },
    accent: { hue: 35, chroma: 0.13, lightness: 48, darkLightness: 72 },
  },
  type: {
    display: { source: 'curated', id: 'source-serif-4' },
    reading: { source: 'curated', id: 'source-serif-4' },
    interface: { source: 'curated', id: 'inter' },
    mono: { source: 'curated', id: 'jetbrains-mono' },
    scale: {
      size: 18.5,
      leading: 1.68,
      measure: 40,
      lede: { size: 22, lineHeight: 32 },
      h1: { size: 40, lineHeight: 46, weight: 560, tracking: -0.015 },
      h2: { size: 27, lineHeight: 34, weight: 560, tracking: -0.01 },
      h3: { size: 21, lineHeight: 28, weight: 600 },
      h4: { size: 17, lineHeight: 26, weight: 600 },
      space: { h2: 56, h3: 36 },
      eyebrow: { size: 13, weight: 550, tracking: 0.04 },
      table: { size: 14, leading: 1.5 },
      code: { size: 14 },
    },
    links: { text: 'ink', underline: 'accent', thickness: 1, hoverThickness: 2, offset: 3.5 },
  },
  variants: {
    comments: 'sidenotes',
    history: 'menu',
    navigation: 'tree',
    header: 'breadcrumb',
    rules: 'plain',
  },
  shape: { radiusStep: 2, density: 'comfortable' },
  levers: ['reading-face', 'accent', 'tone', 'logo', 'radius', 'density'],
}
