import { tv, type ListboxGroup } from '@quill/ui'

import { useSearchSuggestions, type SearchSuggestionField } from '../../lib/api/index.ts'
import {
  FILTERS,
  acceptSuggestion,
  keySuggestions,
  tokenAt,
  type Edit,
  type FilterDescription,
  type QueryToken,
} from './search-filters.ts'
import { useDebouncedValue } from './use-debounced-value.ts'

/**
 * How long a pause in typing means "suggest for this".
 *
 * Shorter than the palette's search (180 ms): a suggestion is a handful of
 * names from an index, and the list narrowing under the keys is what makes it
 * feel like typeahead rather than a search.
 */
export const TYPEAHEAD_DEBOUNCE_MS = 150

const SUGGESTION_FIELDS: ReadonlySet<string> = new Set(
  FILTERS.filter((filter) => filter.suggests).map((filter) => filter.key),
)

/** Whether the server can suggest values for this filter (`FILTERS` says so; a test pins it to the contract). */
export function isSuggestionField(key: string): key is SearchSuggestionField {
  return SUGGESTION_FIELDS.has(key)
}

export const typeaheadStyles = tv({
  slots: {
    key: 'font-mono text-2xs text-foreground',
    hint: 'text-xs text-muted',
  },
})

/** What a filter is called in the list, and what it finds: "team: Anyone in a group or unit". */
function FilterDetail({ filter }: { readonly filter: FilterDescription }) {
  const styles = typeaheadStyles()
  return (
    <span>
      <span className={styles.key()}>{filter.key}:</span>{' '}
      <span className={styles.hint()}>{filter.hint}</span>
    </span>
  )
}

export interface FilterTypeaheadInput {
  /** The query as typed. */
  readonly text: string
  /**
   * Where the caret is, or `null` when nobody has been in the box yet: a page
   * that loads with `by:me` in it must not ask the server for suggestions
   * nobody has opened.
   */
  readonly caret: number | null
  /** The workspace the search is run from, by id or slug. */
  readonly workspaceId: string | null
}

export interface FilterTypeahead {
  /** At most one group: the values for a filter, or the filters a word begins. */
  readonly groups: readonly ListboxGroup[]
  /** Said in place of options: "Searching…" or "Nothing suggested". */
  readonly notice: string | undefined
  /** The settled answer in a sentence, for a screen reader; nothing while one is on the way. */
  readonly status: string | undefined
  /** The values are on the way. */
  readonly busy: boolean
  /** Choosing a filter's name leaves the list open, because its values come next. */
  readonly keepsOpen: (optionId: string) => boolean
  /** The text and caret that choosing this option leads to, or undefined for an option not offered. */
  readonly accept: (optionId: string) => Edit | undefined
}

const NOTHING: FilterTypeahead = {
  groups: [],
  notice: undefined,
  status: undefined,
  busy: false,
  keepsOpen: () => false,
  accept: () => undefined,
}

const FILTER_OPTION = 'filter:'
const VALUE_OPTION = 'value:'

/** The count as a sentence: "1 suggestion", "No suggestions". */
function describeCount(count: number): string {
  if (count === 0) return 'No suggestions'
  return count === 1 ? '1 suggestion' : `${count} suggestions`
}

/** A word that could be the start of a filter's name: not a phrase, whatever its minus. */
function isBareWord(token: QueryToken): boolean {
  const body = token.negated ? token.raw.slice(1) : token.raw
  return token.key === null && body !== '' && !body.startsWith('"')
}

/** What is said in place of options while values are awaited or when there are none. */
function valuesNotice(failed: boolean, waiting: boolean, count: number): string | undefined {
  if (failed) return undefined
  if (waiting) return 'Searching…'
  return count === 0 ? 'Nothing suggested' : undefined
}

/**
 * Typeahead for the filters in a query, shared by the results page's field and
 * the palette (Strategy: the surface supplies the text and the caret, this
 * decides what is worth offering).
 *
 * Two kinds of offer, by where the caret is:
 *
 * - in a **bare word** that begins a filter's name ("te"), the filters, so
 *   discovering one does not mean knowing its name; choosing one writes `team:`
 *   and the next thing offered is its values;
 * - in a **filter whose values the server can suggest** (`by:ad`), those values,
 *   asked for after a pause with the previous list kept on show meanwhile.
 *
 * Anywhere else — a word that is not a filter, a phrase, whitespace — it offers
 * nothing, which is what keeps the list from opening on every space.
 *
 * Nothing is stored: the groups, the notice and the edit a choice leads to are
 * all derived from `text` and `caret` on every render, so the list can never
 * describe a query the box no longer holds.
 */
export function useFilterTypeahead({
  text,
  caret,
  workspaceId,
}: FilterTypeaheadInput): FilterTypeahead {
  const token = caret === null ? undefined : tokenAt(text, Math.min(caret, text.length))
  const filter = token?.key == null ? undefined : FILTERS.find((entry) => entry.key === token.key)
  const field = filter?.suggests === true && isSuggestionField(filter.key) ? filter.key : undefined

  // One primitive is debounced, not a pair of them: the timer restarts when the
  // value *changes*, and a fresh object each render would never settle.
  const wanted = field === undefined ? '' : `${field}:${token?.value ?? ''}`
  const asked = useDebouncedValue(wanted, TYPEAHEAD_DEBOUNCE_MS)
  const separator = asked.indexOf(':')
  const askedField = asked.slice(0, Math.max(separator, 0))
  const suggestions = useSearchSuggestions({
    field: isSuggestionField(askedField) ? askedField : undefined,
    prefix: asked.slice(separator + 1),
    workspaceId,
  })

  if (token === undefined) return NOTHING

  if (filter !== undefined && field !== undefined) {
    // `keepPreviousData` can hand over the last filter's values for a moment;
    // they are not this filter's, and the response names the one it answers.
    const values = suggestions.data?.field === field ? suggestions.data.suggestions : []
    const settled = asked === wanted && !suggestions.isFetching
    const waiting = suggestions.isPending || (!settled && values.length === 0)
    return {
      groups:
        values.length === 0
          ? []
          : [
              {
                id: 'values',
                label: filter.label,
                options: values.map((value, index) => ({
                  id: `${VALUE_OPTION}${index}`,
                  label: value.label,
                })),
              },
            ],
      notice: valuesNotice(suggestions.isError, waiting, values.length),
      status:
        settled && !suggestions.isError && !waiting ? describeCount(values.length) : undefined,
      busy: !settled,
      keepsOpen: () => false,
      accept: (optionId) => {
        const chosen = optionId.startsWith(VALUE_OPTION)
          ? values[Number(optionId.slice(VALUE_OPTION.length))]
          : undefined
        return chosen === undefined ? undefined : acceptSuggestion(text, token, field, chosen.value)
      },
    }
  }

  const begun = isBareWord(token) ? keySuggestions(token.value) : []
  if (begun.length === 0) return NOTHING
  return {
    groups: [
      {
        id: 'filters',
        label: 'Filters',
        options: begun.map((candidate) => ({
          id: `${FILTER_OPTION}${candidate.key}`,
          label: candidate.label,
          detail: <FilterDetail filter={candidate} />,
        })),
      },
    ],
    notice: undefined,
    status: describeCount(begun.length),
    busy: false,
    keepsOpen: (optionId) => optionId.startsWith(FILTER_OPTION),
    accept: (optionId) => {
      const chosen = begun.find((candidate) => `${FILTER_OPTION}${candidate.key}` === optionId)
      return chosen === undefined ? undefined : acceptSuggestion(text, token, chosen.key, null)
    },
  }
}
