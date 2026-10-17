import type { ThemeDocument } from '../schema/theme-document.ts'
import { familyOf, intensityOf, type ColourChoice } from './colour-choice.ts'
import { swatchMatching } from './swatches.ts'
import { TONE_TEMPERATURES, TONE_TINTS, temperatureOf, tintOf } from './tone-choice.ts'

/**
 * A colour choice in the words the picker uses, for a summary that is read
 * rather than worked with — the conflict notice, a list of labels: the
 * swatch's name when it is one, otherwise its strength and family.
 */
export const describeColour = (choice: ColourChoice): string =>
  swatchMatching(choice)?.name ??
  `${intensityOf(choice.chroma).name} ${familyOf(choice.hue).name.toLowerCase()}`

/** The greys in the words the greys control uses, and "custom" for a fine-tuned part. */
export const describeGreys = (seeds: ThemeDocument['seeds']): string => {
  const temperature = temperatureOf(seeds.tone, seeds.accent.hue)
  const tint = tintOf(seeds.tone)
  const temperatureName = TONE_TEMPERATURES.find((entry) => entry.id === temperature)?.name
  const tintName = TONE_TINTS.find((entry) => entry.id === tint)?.name.toLowerCase()
  return `${temperatureName ?? 'Custom hue'}, ${tintName ?? 'custom tint'}`
}
