import { useId, useState } from 'react'

import type { FieldFilterKey } from '@quill/search/query'
import { PillButton, tv } from '@quill/ui'

import type { SearchFacets, SearchResults } from '../../lib/api/index.ts'
import { refinements, type RefinementGroup } from './refinements.ts'

export const refineFacetsStyles = tv({
  slots: {
    root: 'flex min-w-0 flex-col gap-3',
    heading: 'text-xs font-medium tracking-wide text-muted uppercase',
    group: 'flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3',
    label: 'text-xs text-muted sm:w-20 sm:shrink-0 sm:pt-1',
    list: 'flex min-w-0 flex-wrap items-center gap-1.5',
    item: 'flex max-w-full min-w-0',
  },
})

const counts = new Intl.NumberFormat()

function describeCount(count: number): string {
  return `${counts.format(count)} ${count === 1 ? 'result' : 'results'}`
}

export interface RefineFacetsProps {
  readonly facets: SearchFacets | undefined
  /** The query that was asked: what it already filters on is not offered again. */
  readonly query: string
  readonly onRefine: (key: FieldFilterKey, value: string) => void
  readonly className?: string | undefined
}

function Group({
  group,
  onRefine,
}: {
  readonly group: RefinementGroup
  readonly onRefine: RefineFacetsProps['onRefine']
}) {
  const id = useId()
  const styles = refineFacetsStyles()

  return (
    <div className={styles.group()}>
      <p id={id} className={styles.label()}>
        {group.label}
      </p>
      <ul aria-labelledby={id} className={styles.list()}>
        {group.values.map((facet) => (
          <li key={facet.value} className={styles.item()}>
            <PillButton
              detail={counts.format(facet.count)}
              aria-label={`${facet.label}, ${describeCount(facet.count)}`}
              onClick={() => {
                onRefine(group.key, facet.value)
              }}
            >
              {facet.label}
            </PillButton>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Ways to narrow the results, from the counts the server sent: each button
 * adds one filter to the query it was counted for. They are suggestions, drawn
 * as outlined pills with a plus, apart from the chips above them, which are
 * filters already applied (`docs/design/search.md`).
 *
 * Nothing at all when nothing is left to offer, rather than a heading over an
 * empty region.
 */
export function RefineFacets({ facets, query, onRefine, className }: RefineFacetsProps) {
  const headingId = useId()
  const styles = refineFacetsStyles()
  const groups = refinements(facets, query)
  if (groups.length === 0) return undefined

  return (
    <section aria-labelledby={headingId} className={styles.root({ className })}>
      <h2 id={headingId} className={styles.heading()}>
        Refine
      </h2>
      {groups.map((group) => (
        <Group key={group.name} group={group} onRefine={onRefine} />
      ))}
    </section>
  )
}

/**
 * The facets to show: those of the latest answer, held over while the next one
 * is on its way so the row does not blink out and back on every refinement.
 * An answer that has no facets (nothing matched) replaces them with nothing.
 *
 * Reset while rendering, as the page's draft is, rather than in an effect:
 * an effect would paint one frame of the old facets under the new answer.
 */
export function useRetainedFacets(answer: SearchResults | undefined): SearchFacets | undefined {
  const [from, setFrom] = useState(answer)
  const [retained, setRetained] = useState(answer?.facets)
  if (answer !== undefined && answer !== from) {
    setFrom(answer)
    setRetained(answer.facets)
  }
  return retained
}
