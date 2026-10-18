import { FilterChip, tv } from '@quill/ui'

import type { FilterChip as FilterChipDescription } from './search-filters.ts'

export const filterChipListStyles = tv({
  slots: {
    list: 'flex min-w-0 flex-wrap items-center gap-2',
    item: 'flex min-w-0 max-w-full',
  },
})

export interface FilterChipListProps {
  readonly chips: readonly FilterChipDescription[]
  readonly onRemove: (chip: FilterChipDescription) => void
  readonly className?: string | undefined
}

/**
 * The filters in a query as chips, each with a way to take it off.
 *
 * Shared by the results page and the palette, so a filter reads and is removed
 * the same way in both. A list, because the count is part of what it says; and
 * nothing at all, not an empty list, when there are no filters.
 */
export function FilterChipList({ chips, onRemove, className }: FilterChipListProps) {
  const styles = filterChipListStyles()
  if (chips.length === 0) return undefined

  return (
    <ul aria-label="Filters" className={styles.list({ className })}>
      {chips.map((chip) => (
        <li key={chip.clause} className={styles.item()}>
          <FilterChip
            negated={chip.negated}
            removeLabel={`Remove filter ${chip.text}`}
            onRemove={() => {
              onRemove(chip)
            }}
          >
            {chip.text}
          </FilterChip>
        </li>
      ))}
    </ul>
  )
}
