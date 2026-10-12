import { useId, useState } from 'react'

import { Input, MenuButton, tv } from '@quill/ui'

import {
  COLOUR_WRITE_FORMATS,
  choiceOfColour,
  paintedColour,
  readColour,
  writeColour,
  type ColourChoice,
  type ColourFormat,
  type ColourReadError,
} from '@quill/theme'

const brandColourStyles = tv({
  slots: {
    root: 'flex flex-col gap-1',
    // Bottom-aligned, so the well and the menu sit on the field and not on its label.
    row: 'flex items-end gap-2',
    field: 'min-w-0 grow',
    well: [
      'size-8 shrink-0 cursor-pointer appearance-none rounded-md border border-border',
      'bg-surface-raised p-0.5',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
      '[&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-0',
      '[&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0',
      '[&::-webkit-color-swatch-wrapper]:p-0',
    ],
    note: 'text-2xs leading-normal text-muted data-invalid:text-danger',
  },
  variants: {
    touch: { true: { well: 'size-11', note: 'text-xs' } },
  },
})

/** How each format is named back to the person who typed it: "Read as HSL". */
const FORMAT_NAMES: Readonly<Record<ColourFormat, string>> = {
  hex: 'hex',
  rgb: 'RGB',
  hsl: 'HSL',
  hwb: 'HWB',
  oklch: 'OKLCH',
  oklab: 'OKLab',
  lab: 'Lab',
  lch: 'LCH',
  cmyk: 'CMYK, converted without a print profile',
  triple: 'RGB values',
  named: 'a CSS colour name',
}

const ACCEPTED =
  'Use hex, rgb(), hsl(), hwb(), oklch(), oklab(), lab(), lch(), cmyk(), “R, G, B” or a CSS colour name.'

const HELP =
  'From your brand guide: hex, RGB, HSL, OKLCH, Lab, CMYK, “R, G, B” or a CSS name. Pantone has no open conversion, so use the hex beside it.'

const KEPT = 'Kept your hue; links and buttons are tuned for contrast.'

/** An empty field is not an error: it is somebody about to paste. */
function errorMessage(error: ColourReadError): string | undefined {
  switch (error.kind) {
    case 'empty':
      return undefined
    case 'unrecognised':
      return `That is not a colour format we know. ${ACCEPTED}`
    case 'invalid':
      return `That looks like ${FORMAT_NAMES[error.format]} but is not a valid one. ${ACCEPTED}`
  }
}

export interface BrandColourFieldProps {
  readonly value: ColourChoice
  readonly onValueChange: (choice: ColourChoice) => void
  readonly touch?: boolean | undefined
}

type CopyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'copied' | 'failed'; readonly text: string }

/**
 * A brand colour, as the brand guide writes it.
 *
 * The text is what was typed, until the colour well replaces it: a person who
 * pasted `hsl(174 80% 30%)` keeps seeing that, with the format it was read as,
 * rather than having it rewritten under them. A colour that does not read
 * leaves the theme as it was and says why. "Copy as" writes the chosen colour
 * back out, so it can go back into the guide or a design tool.
 */
export function BrandColourField({ value, onValueChange, touch = false }: BrandColourFieldProps) {
  const [typed, setTyped] = useState<string | undefined>(undefined)
  const [copy, setCopy] = useState<CopyState>({ kind: 'idle' })
  const wellId = useId()
  const noteId = useId()
  const styles = brandColourStyles({ touch })

  const colour = paintedColour(value)
  const hex = writeColour(colour, 'hex')
  const read = typed === undefined ? undefined : readColour(typed)
  const error = read?.ok === false ? errorMessage(read.error) : undefined

  function choose(text: string) {
    const result = readColour(text)
    if (result.ok) onValueChange(choiceOfColour(result.value.colour))
  }

  async function copyAs(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopy({ kind: 'copied', text })
    } catch {
      setCopy({ kind: 'failed', text })
    }
  }

  const description =
    read?.ok === true
      ? [
          `Read as ${FORMAT_NAMES[read.value.format]}.`,
          read.value.broughtIntoGamut
            ? 'It was beyond what screens show, so its strength was reduced to fit.'
            : undefined,
          KEPT,
        ]
          .filter((sentence) => sentence !== undefined)
          .join(' ')
      : HELP

  return (
    <div className={styles.root()}>
      <div className={styles.row()}>
        {/*
         * The help and the error are this field's own paragraph rather than
         * `Input`'s, because they sit under the whole row — field, well and
         * menu — which is what keeps the three aligned on the field.
         */}
        <Input
          label="Brand colour"
          className={styles.field()}
          size={touch ? 'lg' : 'md'}
          value={typed ?? hex}
          placeholder="#0f8a7e, rgb(15 138 126), hsl(174 80% 30%)…"
          spellCheck={false}
          autoComplete="off"
          aria-describedby={noteId}
          aria-invalid={error !== undefined}
          onChange={(event) => {
            setTyped(event.target.value)
            choose(event.target.value)
          }}
        />
        <label htmlFor={wellId} className="sr-only">
          Pick the brand colour
        </label>
        <input
          id={wellId}
          type="color"
          value={hex}
          className={styles.well()}
          onChange={(event) => {
            setTyped(undefined)
            choose(event.target.value)
          }}
        />
        <MenuButton
          label="Copy the colour as"
          align="end"
          sections={[
            {
              id: 'formats',
              entries: COLOUR_WRITE_FORMATS.map((format) => {
                const text = writeColour(colour, format)
                return {
                  kind: 'action',
                  label: text,
                  onSelect: () => {
                    void copyAs(text)
                  },
                }
              }),
            },
          ]}
        >
          <span className="text-xs whitespace-nowrap">Copy as…</span>
        </MenuButton>
      </div>
      <p
        id={noteId}
        role={error === undefined ? undefined : 'alert'}
        data-invalid={error === undefined ? undefined : true}
        className={styles.note()}
      >
        {error ?? description}
      </p>
      <p role="status" className={styles.note()}>
        {copy.kind === 'copied' ? `Copied ${copy.text}.` : undefined}
        {copy.kind === 'failed'
          ? `Copying was refused by the browser. The colour is ${copy.text}.`
          : undefined}
      </p>
    </div>
  )
}
