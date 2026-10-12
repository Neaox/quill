import { useId } from 'react'

import { tv } from '@quill/ui'

import { useCustomProperty } from '../../../lib/dom/use-custom-property.ts'

/**
 * The radio carries the selection and `peer-checked:` carries the ring, as in
 * `SegmentedControl`: nothing here decides a look from a prop, and the ring
 * cannot show one option while the radio announces another.
 */
const colourOptions = tv({
  slots: {
    // A container, so the swatch grid can choose its columns from the room it has.
    frame: '@container',
    root: 'm-0 flex flex-wrap gap-2 border-0 p-0',
    option: 'relative flex',
    input: 'peer absolute inset-0 z-10 m-0 cursor-pointer appearance-none opacity-0',
    label: [
      'inline-flex cursor-pointer items-center justify-center rounded-full',
      'peer-checked:ring-2 peer-checked:ring-foreground peer-checked:ring-offset-2',
      'peer-checked:ring-offset-background',
      'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4',
      'peer-focus-visible:outline-focus-ring',
    ],
    dot: 'shrink-0 rounded-full bg-(--paint) ring-1 ring-foreground/10 ring-inset',
    name: '',
  },
  variants: {
    /** A swatch is the colour alone, its name announced and shown on hover. */
    variant: {
      // Twelve swatches as two even rows of six, never eleven and an orphan.
      swatch: { root: 'grid w-fit grid-cols-6', dot: 'size-8', name: 'sr-only' },
      chip: {
        label: [
          'h-8 gap-2 border border-border bg-surface-raised ps-2 pe-3 text-xs text-foreground-soft',
          'hover:text-foreground peer-checked:border-transparent peer-checked:text-foreground',
        ],
        dot: 'size-3.5',
      },
    },
    /** A phone's targets are 44 pixels, the smallest WCAG 2.5.5 accepts. */
    touch: {
      true: { root: 'gap-2.5' },
    },
  },
  compoundVariants: [
    {
      variant: 'swatch',
      touch: true,
      class: { root: 'grid-cols-4 @sm:grid-cols-6', dot: 'size-11' },
    },
    { variant: 'chip', touch: true, class: { label: 'h-11 ps-3 pe-4 text-sm' } },
  ],
})

export interface ColourOption {
  readonly id: string
  readonly name: string
  /** A CSS colour to paint the option with. */
  readonly colour: string
}

export interface ColourOptionsProps<Option extends ColourOption> {
  /** Names the group, visually hidden: the tab or field it sits in shows it. */
  readonly legend: string
  readonly options: readonly Option[]
  /** The chosen option's id, or `undefined` when the current colour is none of them. */
  readonly value: string | undefined
  readonly onChoose: (option: Option) => void
  readonly variant: 'swatch' | 'chip'
  readonly touch?: boolean | undefined
}

/**
 * A set of colours to choose one of: the curated swatches, the colour
 * families. Native radios, so the group is one tab stop with arrow keys
 * between the options and the checked one announced without ARIA of our own.
 * Nothing is checked when the current colour is none of the options, unless
 * the caller offers it as one (`ColourControl`'s "Custom" swatch).
 */
export function ColourOptions<Option extends ColourOption>({
  legend,
  options,
  value,
  onChoose,
  variant,
  touch = false,
}: ColourOptionsProps<Option>) {
  const name = useId()
  const styles = colourOptions({ variant, touch })

  return (
    <div className={styles.frame()}>
      <fieldset role="radiogroup" className={styles.root()}>
        <legend className="sr-only">{legend}</legend>
        {options.map((option) => {
          const id = `${name}-${option.id}`
          return (
            <div key={option.id} className={styles.option()}>
              <input
                type="radio"
                id={id}
                name={name}
                value={option.id}
                checked={option.id === value}
                onChange={() => {
                  onChoose(option)
                }}
                className={styles.input()}
              />
              <label htmlFor={id} title={option.name} className={styles.label()}>
                <PaintedDot colour={option.colour} className={styles.dot()} />
                <span className={styles.name()}>{option.name}</span>
              </label>
            </div>
          )
        })}
      </fieldset>
    </div>
  )
}

function PaintedDot({
  colour,
  className,
}: {
  readonly colour: string
  readonly className: string
}) {
  return (
    <span aria-hidden="true" ref={useCustomProperty('--paint', colour)} className={className} />
  )
}
