import { CHROMA_BUDGET, chromaTrack, hueTrack, type ColourChoice } from '@quill/theme'

import { RangeField } from '../range-field.tsx'

export interface ColourSlidersProps {
  readonly value: ColourChoice
  readonly onValueChange: (choice: ColourChoice) => void
  readonly hueLabel: string
  readonly chromaLabel: string
  /** The hue in words, the readout a person reads first: "Teal", "Warm". */
  readonly describeHue: (hue: number) => string
  /** The strength in words: "Balanced", "Subtle". */
  readonly describeChroma: (chroma: number) => string
  /**
   * The top of the strength slider. For an accent it is the generator's own
   * ceiling, not the schema's: links and controls never carry more, so the
   * track shows real change end to end. A stored chroma above it still
   * validates, and the slider shows it at the end of the track.
   */
  readonly maxChroma?: number | undefined
  readonly chromaStep?: number | undefined
  /**
   * What the tracks are painted from. A tone's own chroma is too faint to show
   * a direction, so its tracks are painted stronger than the tone itself.
   */
  readonly paintedAs?: ColourChoice | undefined
}

/**
 * A hue and a chroma as two sliders whose tracks show the colours they choose
 * between: every hue at the current strength, and grey to vivid at the
 * current hue. The readout is in words; the number is beside it, quieter, for
 * whoever wants to write it down.
 *
 * A slider moves its own seed and keeps every other field the choice carries,
 * a brand's exact lightness included.
 */
export function ColourSliders({
  value,
  onValueChange,
  hueLabel,
  chromaLabel,
  describeHue,
  describeChroma,
  maxChroma = CHROMA_BUDGET.accentMaximum,
  chromaStep = 0.005,
  paintedAs = value,
}: ColourSlidersProps) {
  return (
    <div className="flex flex-col gap-4">
      <RangeField
        label={hueLabel}
        value={value.hue}
        min={0}
        max={359}
        step={1}
        display={describeHue(value.hue)}
        detail={`${Math.round(value.hue)}°`}
        track={hueTrack(paintedAs)}
        onValueChange={(hue) => {
          onValueChange({ ...value, hue })
        }}
      />
      <RangeField
        label={chromaLabel}
        value={value.chroma}
        min={0}
        max={maxChroma}
        step={chromaStep}
        display={describeChroma(value.chroma)}
        detail={value.chroma.toFixed(3)}
        track={chromaTrack(paintedAs, maxChroma)}
        onValueChange={(chroma) => {
          onValueChange({ ...value, chroma })
        }}
      />
    </div>
  )
}
