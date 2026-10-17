import {
  COLOUR_FAMILIES,
  INTENSITIES,
  familyOf,
  formatOklch,
  intensityOf,
  paintedColour,
  type ColourChoice,
} from '@quill/theme'

import { SegmentedControl } from '../../theme/segmented-control.tsx'
import { ColourOptions } from './colour-options.tsx'

export interface ColourInWordsProps {
  readonly value: ColourChoice
  readonly onValueChange: (choice: ColourChoice) => void
  readonly touch?: boolean | undefined
}

/**
 * A colour described rather than measured: a family and a strength. Every hue
 * belongs to its nearest family and every chroma to its nearest strength, so
 * something is always chosen here, and choosing moves only the seed it names.
 */
export function ColourInWords({ value, onValueChange, touch = false }: ColourInWordsProps) {
  const intensity = intensityOf(value.chroma)

  return (
    <div className="flex flex-col gap-4">
      <ColourOptions
        legend="Colour family"
        variant="chip"
        touch={touch}
        value={familyOf(value.hue).id}
        options={COLOUR_FAMILIES.map((family) => ({
          ...family,
          colour: formatOklch(paintedColour({ hue: family.hue, chroma: intensity.chroma })),
        }))}
        onChoose={(family) => {
          onValueChange({ ...value, hue: family.hue })
        }}
      />
      <SegmentedControl
        legend="Strength"
        size={touch ? 'touch' : 'md'}
        className="self-start"
        value={intensity.id}
        segments={INTENSITIES.map((level) => ({ value: level.id, label: level.name }))}
        onValueChange={(id) => {
          const chosen = INTENSITIES.find((level) => level.id === id)
          if (chosen !== undefined) onValueChange({ ...value, chroma: chosen.chroma })
        }}
      />
    </div>
  )
}
