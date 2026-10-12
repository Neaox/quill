import { useId } from 'react'
import { tv } from 'tailwind-variants'

/**
 * A labelled choice among a few values, for the settings a block carries.
 *
 * A native `select`: it is keyboard- and screen-reader-complete without help,
 * and the block it sits in is not the place to reinvent one. The label is real
 * text, not an `aria-label`, so what is read and what is seen are the same words.
 */

const levelSelect = tv({
  slots: {
    root: 'flex items-center gap-1.5 text-xs text-muted',
    select: [
      'h-7 rounded-sm border border-border-strong bg-surface-raised px-1.5 text-xs text-foreground',
      'focus-visible:outline-2 focus-visible:outline-focus-ring',
    ],
  },
})
const styles = levelSelect()

export interface LevelOption<T extends number> {
  readonly value: T
  readonly label: string
}

export interface LevelSelectProps<T extends number> {
  readonly label: string
  readonly value: T
  readonly options: readonly LevelOption<T>[]
  onChange(value: T): void
}

export function LevelSelect<T extends number>({
  label,
  value,
  options,
  onChange,
}: LevelSelectProps<T>) {
  const id = useId()
  return (
    <div className={styles.root()}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className={styles.select()}
        value={value}
        onChange={(event) => {
          const chosen = options.find((option) => String(option.value) === event.target.value)
          if (chosen !== undefined) onChange(chosen.value)
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
