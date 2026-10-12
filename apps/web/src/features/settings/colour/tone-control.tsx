import { tv } from '@quill/ui'

import {
  SEED_CHROMA_MAX,
  TONE_TEMPERATURES,
  TONE_TINTS,
  temperatureOf,
  tintOf,
  withTemperature,
  withTint,
  type ToneSeedValue,
} from '@quill/theme'

import { TOUCH_TARGET_QUERY, useMediaQuery } from '../../layout/use-media-query.ts'
import { SegmentedControl } from '../../theme/segmented-control.tsx'
import { ColourSliders } from './colour-sliders.tsx'

/**
 * A tone's own chroma is a few thousandths, too faint for a track to show a
 * direction, so the fine-tune tracks paint its hue at the schema's ceiling
 * and a light grey's lightness: the colour the greys lean towards.
 */
const TRACK_LIGHTNESS = 85

const toneControlStyles = tv({
  slots: {
    root: 'm-0 flex flex-col gap-2 border-0 p-0',
    legend: 'mb-2 text-xs font-medium text-foreground',
    choices: 'flex flex-wrap gap-2',
    description: 'text-2xs leading-normal text-muted',
    fineTune: 'group mt-1',
    summary: [
      'w-fit cursor-pointer rounded-sm text-xs text-foreground-soft hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
    ],
    sliders: 'pt-3',
  },
  variants: {
    touch: { true: { choices: 'flex-col', summary: 'py-3 text-sm' } },
  },
})

export interface ToneControlProps {
  readonly tone: ToneSeedValue
  /** The accent's hue, which a neutral tone follows. */
  readonly accentHue: number
  readonly onToneChange: (tone: ToneSeedValue) => void
}

/**
 * The greys, in words: a temperature and a tint, with the exact hue and
 * chroma one disclosure away for whoever needs them. A tone set by the
 * sliders to a value neither word names leaves both segments unchosen, so the
 * words never claim a value they do not hold.
 */
export function ToneControl({ tone, accentHue, onToneChange }: ToneControlProps) {
  const touch = useMediaQuery(TOUCH_TARGET_QUERY)
  const temperature = temperatureOf(tone, accentHue)
  const tint = tintOf(tone)
  const styles = toneControlStyles({ touch })
  const size = touch ? 'touch' : 'md'
  const temperatureName = TONE_TEMPERATURES.find((entry) => entry.id === temperature)?.name
  const tintName = TONE_TINTS.find((entry) => entry.id === tint)?.name

  return (
    <fieldset className={styles.root()}>
      <legend className={styles.legend()}>Greys</legend>
      <div className={styles.choices()}>
        <SegmentedControl
          legend="Temperature"
          size={size}
          value={temperature}
          segments={TONE_TEMPERATURES.map((entry) => ({ value: entry.id, label: entry.name }))}
          onValueChange={(next) => {
            onToneChange(withTemperature(tone, next, accentHue))
          }}
        />
        <SegmentedControl
          legend="Tint"
          size={size}
          value={tint}
          segments={TONE_TINTS.map((entry) => ({ value: entry.id, label: entry.name }))}
          onValueChange={(next) => {
            onToneChange(withTint(tone, next))
          }}
        />
      </div>
      <p className={styles.description()}>
        Neutral follows the accent’s hue. Subtle reads as grey beside any accent; tinted carries the
        temperature into every surface.
      </p>
      <details className={styles.fineTune()}>
        <summary className={styles.summary()}>Fine-tune</summary>
        <div className={styles.sliders()}>
          <ColourSliders
            value={tone}
            onValueChange={(choice) => {
              onToneChange({ ...tone, hue: choice.hue, chroma: choice.chroma })
            }}
            hueLabel="Grey hue"
            chromaLabel="Grey tint"
            describeHue={() => temperatureName ?? 'Custom'}
            describeChroma={() => tintName ?? 'Custom'}
            maxChroma={SEED_CHROMA_MAX.tone}
            chromaStep={0.001}
            paintedAs={{
              hue: tone.hue,
              chroma: SEED_CHROMA_MAX.tone,
              lightness: TRACK_LIGHTNESS,
            }}
          />
        </div>
      </details>
    </fieldset>
  )
}
