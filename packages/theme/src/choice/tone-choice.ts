import { CHROMA_BUDGET } from '../colour/bands.ts'
import { hueDistance } from '../colour/hue.ts'
import type { ThemeDocument, ToneSeedValue } from '../schema/theme-document.ts'
import type { ColourChoice } from './colour-choice.ts'

type Seeds = ThemeDocument['seeds']

/**
 * The greys, in two words instead of two numbers: a temperature and a tint.
 *
 * Cool and warm are fixed hues — the blue-grey and the paper-yellow the
 * built-ins already use. Neutral is not a hue of its own: it is the accent's,
 * which is the analogous tone the doctor prefers (colour rules, section 5),
 * and it keeps following the accent as the accent changes (`withAccentChoice`).
 */
export const TONE_TEMPERATURES = [
  { id: 'cool', name: 'Cool' },
  { id: 'neutral', name: 'Neutral' },
  { id: 'warm', name: 'Warm' },
] as const

export type ToneTemperature = (typeof TONE_TEMPERATURES)[number]['id']

const TEMPERATURE_HUE = { cool: 250, warm: 70 } as const

/**
 * Subtle stays below the chroma at which a tint is visible, so it agrees with
 * any accent; tinted is the most a page of grey may carry (`CHROMA_BUDGET.paper`).
 */
export const TONE_TINTS = [
  { id: 'subtle', name: 'Subtle' },
  { id: 'tinted', name: 'Tinted' },
] as const

export type ToneTint = (typeof TONE_TINTS)[number]['id']

const TINT_CHROMA = {
  subtle: CHROMA_BUDGET.paperTintMinimum,
  tinted: CHROMA_BUDGET.paper,
} as const satisfies Record<ToneTint, number>

const SAME_HUE = 0.5
const SAME_CHROMA = 1e-6

const hueOfTemperature = (temperature: ToneTemperature, accentHue: number): number =>
  temperature === 'neutral' ? accentHue : TEMPERATURE_HUE[temperature]

/**
 * The temperature a tone is, or `undefined` when it is a hue of its own that
 * only the fine-tune sliders describe. Neutral is asked first: a tone on the
 * accent's hue follows the accent, and what is shown should say so even when
 * the accent happens to sit on the cool or warm hue.
 */
export const temperatureOf = (
  tone: ToneSeedValue,
  accentHue: number,
): ToneTemperature | undefined =>
  (['neutral', 'cool', 'warm'] as const).find(
    (temperature) => hueDistance(tone.hue, hueOfTemperature(temperature, accentHue)) < SAME_HUE,
  )

/** The tint a tone is, or `undefined` for a chroma only the fine-tune slider sets. */
export const tintOf = (tone: ToneSeedValue): ToneTint | undefined =>
  TONE_TINTS.find((tint) => Math.abs(TINT_CHROMA[tint.id] - tone.chroma) < SAME_CHROMA)?.id

export const withTemperature = (
  tone: ToneSeedValue,
  temperature: ToneTemperature,
  accentHue: number,
): ToneSeedValue => ({ ...tone, hue: hueOfTemperature(temperature, accentHue) })

export const withTint = (tone: ToneSeedValue, tint: ToneTint): ToneSeedValue => ({
  ...tone,
  chroma: TINT_CHROMA[tint],
})

/**
 * A new accent, with a neutral tone carried along: a tone that was on the
 * accent's hue stays on it, so choosing Neutral once means it, rather than
 * pinning the greys to whatever the accent was at the time.
 */
export const withAccentChoice = (seeds: Seeds, accent: ColourChoice): Seeds => ({
  ...seeds,
  accent,
  tone:
    temperatureOf(seeds.tone, seeds.accent.hue) === 'neutral'
      ? { ...seeds.tone, hue: accent.hue }
      : seeds.tone,
})
