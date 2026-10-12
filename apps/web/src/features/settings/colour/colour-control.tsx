import { useId } from 'react'

import { BRAND } from '@quill/brand'

import { Tab, TabList, TabPanel, Tabs, tv } from '@quill/ui'

import {
  ACCENT_SWATCHES,
  choiceOfSwatch,
  familyOf,
  formatOklch,
  intensityOf,
  paintedColour,
  swatchMatching,
  writeColour,
  type ColourChoice,
} from '@quill/theme'

import { useRememberedChoice } from '../../../lib/storage/use-remembered-choice.ts'
import { TOUCH_TARGET_QUERY, useMediaQuery } from '../../layout/use-media-query.ts'
import { BrandColourField } from './brand-colour-field.tsx'
import { ColourInWords } from './colour-in-words.tsx'
import { ColourOptions } from './colour-options.tsx'
import { ColourSliders } from './colour-sliders.tsx'

const WAYS = [
  { id: 'swatches', name: 'Swatches' },
  { id: 'brand', name: 'Brand' },
  { id: 'sliders', name: 'Sliders' },
  { id: 'words', name: 'Words' },
] as const

type Way = (typeof WAYS)[number]['id']

const WAY_IDS = WAYS.map((way) => way.id)

/** What a compact picker offers: a tuned colour, or the brand's own. */
const COMPACT_WAYS: readonly Way[] = ['swatches', 'brand']

/** One key for every picker, so a viewer who prefers sliders gets sliders everywhere. */
export const REMEMBERED_WAY_KEY = `${BRAND.slug}.colour-control.way`

/** Each swatch as an option, carrying the choice it makes. */
const SWATCH_OPTIONS = ACCENT_SWATCHES.map((swatch) => ({
  id: swatch.id,
  name: swatch.name,
  colour: formatOklch(paintedColour(swatch)),
  choice: choiceOfSwatch(swatch),
}))

const colourControlStyles = tv({
  slots: {
    root: 'flex flex-col gap-2',
    label: 'text-xs font-medium text-foreground',
    panel: 'pt-1',
  },
})

/** The id of the extra swatch a colour that is none of the curated ones takes. */
const CUSTOM_ID = 'custom'

/**
 * The swatches to offer for a value: the curated ones, and — when the value is
 * none of them — the value itself as one more, last and checked, named by the
 * hex the Brand tab shows. Choosing a curated swatch makes the value one of
 * them, so the extra one goes away with nothing to clear.
 */
function swatchesFor(value: ColourChoice, matching: string | undefined) {
  if (matching !== undefined) return SWATCH_OPTIONS
  const painted = paintedColour(value)
  return [
    ...SWATCH_OPTIONS,
    {
      id: CUSTOM_ID,
      name: `Custom, ${writeColour(painted, 'hex')}`,
      colour: formatOklch(painted),
      choice: value,
    },
  ]
}

export interface ColourControlProps {
  /** What is being coloured: "Accent", "Label colour". Names the control and its tabs. */
  readonly label: string
  readonly value: ColourChoice
  readonly onValueChange: (choice: ColourChoice) => void
  /** Swatches and a brand colour only, for a picker that sits in a row: a label, a collection. */
  readonly compact?: boolean | undefined
}

/**
 * One colour, chosen whichever way suits the person choosing it.
 *
 * Four ways in, as tabs: a curated swatch, a brand colour as the guide writes
 * it, two sliders whose tracks show the colours, and a few words. Every tab
 * reads and writes the same choice, so switching tabs never loses it and each
 * shows where the current colour is — the matching swatch, or an extra
 * "Custom" one for a colour that is none of them. The tab last used is remembered for this viewer.
 *
 * Reusable for anything that picks a hue and a chroma (ADR-028's layer 2):
 * the accent here, and a label or a collection in `compact` form.
 */
export function ColourControl({
  label,
  value,
  onValueChange,
  compact = false,
}: ColourControlProps) {
  const touch = useMediaQuery(TOUCH_TARGET_QUERY)
  const offered = compact ? COMPACT_WAYS : WAY_IDS
  const [remembered, remember] = useRememberedChoice<Way>(REMEMBERED_WAY_KEY, WAY_IDS, 'swatches')
  const way = offered.includes(remembered) ? remembered : 'swatches'
  const matchingSwatch = swatchMatching(value)?.id
  const labelId = useId()
  const styles = colourControlStyles()
  const size = touch ? 'touch' : 'md'

  return (
    <div role="group" aria-labelledby={labelId} className={styles.root()}>
      <span id={labelId} className={styles.label()}>
        {label}
      </span>
      <Tabs
        defaultValue="swatches"
        value={way}
        onValueChange={(next) => {
          const chosen = WAY_IDS.find((id) => id === next)
          if (chosen !== undefined) remember(chosen)
        }}
        className="gap-3"
      >
        <TabList
          label={`Ways to choose the ${label.toLowerCase()}`}
          variant="segmented"
          size={size}
        >
          {WAYS.filter((entry) => offered.includes(entry.id)).map((entry) => (
            <Tab key={entry.id} value={entry.id} variant="segmented" size={size}>
              {entry.name}
            </Tab>
          ))}
        </TabList>

        <TabPanel value="swatches" className={styles.panel()}>
          <ColourOptions
            legend={`${label} swatches`}
            variant="swatch"
            touch={touch}
            options={swatchesFor(value, matchingSwatch)}
            value={matchingSwatch ?? CUSTOM_ID}
            onChoose={(option) => {
              onValueChange(option.choice)
            }}
          />
        </TabPanel>

        <TabPanel value="brand" className={styles.panel()}>
          <BrandColourField value={value} onValueChange={onValueChange} touch={touch} />
        </TabPanel>

        {compact ? undefined : (
          <>
            <TabPanel value="sliders" className={styles.panel()}>
              <ColourSliders
                value={value}
                onValueChange={onValueChange}
                hueLabel="Colour"
                chromaLabel="Muted ↔ Vivid"
                describeHue={(hue) => familyOf(hue).name}
                describeChroma={(chroma) => intensityOf(chroma).name}
              />
            </TabPanel>
            <TabPanel value="words" className={styles.panel()}>
              <ColourInWords value={value} onValueChange={onValueChange} touch={touch} />
            </TabPanel>
          </>
        )}
      </Tabs>
    </div>
  )
}
