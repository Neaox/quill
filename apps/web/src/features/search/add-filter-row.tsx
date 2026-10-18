import { useId } from 'react'

import type { FieldFilterKey } from '@quill/search/query'
import { Button, tv } from '@quill/ui'

import { FILTERS } from './search-filters.ts'

export const addFilterRowStyles = tv({
  slots: {
    root: 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2',
    label: 'text-xs text-muted',
    list: 'flex min-w-0 flex-wrap items-center gap-1.5',
    // The touch size on a coarse pointer, as the chip's own remove button does.
    button: 'pointer-coarse:h-11',
  },
})

/** Only the filters with values to suggest: the others are typed, and offering them here would open nothing. */
const OFFERED = FILTERS.filter((filter) => filter.suggests)

export interface AddFilterRowProps {
  readonly onAdd: (key: FieldFilterKey) => void
  readonly className?: string | undefined
}

/**
 * "Add a filter:" and one small button for each filter worth reaching for.
 *
 * Each says what it is called and, to a screen reader, what it finds
 * (`aria-describedby`; the hover title is for the pointer, not the only way
 * to learn it). They wrap rather than disappear on a narrow screen: the point
 * of the row is that nobody has to know the syntax to begin.
 */
export function AddFilterRow({ onAdd, className }: AddFilterRowProps) {
  const ids = useId()
  const styles = addFilterRowStyles()

  return (
    <div className={styles.root({ className })}>
      <p id={`${ids}-label`} className={styles.label()}>
        Add a filter:
      </p>
      <ul aria-labelledby={`${ids}-label`} className={styles.list()}>
        {OFFERED.map((filter) => (
          <li key={filter.key}>
            <Button
              variant="secondary"
              size="sm"
              title={filter.hint}
              aria-describedby={`${ids}-${filter.key}`}
              className={styles.button()}
              onClick={() => {
                onAdd(filter.key)
              }}
            >
              {filter.label}
            </Button>
            <span id={`${ids}-${filter.key}`} className="sr-only">
              {filter.hint}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
