import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'

import { Combobox } from '@quill/ui'
import type { FieldFilterKey } from '@quill/search/query'

import { acceptSuggestion, tokenAt, type Edit } from './search-filters.ts'
import { useFilterTypeahead } from './use-filter-typeahead.tsx'

/** What the page can ask of the field it does not own the insides of. */
export interface SearchQueryFieldHandle {
  /** Puts focus in the box, which opens whatever is worth suggesting at the caret. */
  readonly focus: () => void
  /**
   * Starts a new filter at the end of the query: `key:` after a space, the
   * caret after the colon, focus in the box. What the "Add a filter" buttons do.
   */
  readonly addFilter: (key: FieldFilterKey) => void
}

export interface SearchQueryFieldProps {
  readonly label: string
  /** Controlled: the draft belongs to the page, which also resets it from the address. */
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly placeholder?: string | undefined
  /** The workspace the search is run from, by id or slug, for the suggestions. */
  readonly workspaceId: string | null
  readonly className?: string | undefined
  readonly ref?: Ref<SearchQueryFieldHandle> | undefined
}

/** Where the caret was, and in which text: a position means nothing in any other. */
interface Caret {
  readonly at: number
  readonly text: string
}

/**
 * The results page's query box: a text field that completes filters as they are
 * typed (`use-filter-typeahead.tsx`).
 *
 * **The caret is what decides.** Suggestions are for the token the caret is in,
 * so editing `by:ad` in the middle of a long query offers people, not whatever
 * comes last. The caret is read on every change, and on `selectionchange` (the
 * document's own event, so the arrow keys and a click count too).
 *
 * **Enter is the form's until the arrows have reached an option.** A search for
 * the word "team" must not turn into the filter `team:` because a list happened
 * to be open, so nothing is preselected (`preselect={false}`); ArrowDown then
 * Enter, or a click, chooses.
 *
 * **Choosing a filter's name keeps going.** It writes `team:`, leaves the list
 * open, and the next thing offered is that filter's values. Choosing a value
 * puts the caret straight after it, so typing carries on.
 *
 * A controlled `<input>` puts its caret at the end whenever React sets its
 * value, which is wrong for a choice made in the middle of the text. The DOM
 * selection is an external system React does not render, so it is set after the
 * commit, in a layout effect, before the browser paints.
 */
export function SearchQueryField({
  label,
  value,
  onValueChange,
  placeholder,
  workspaceId,
  className,
  ref,
}: SearchQueryFieldProps) {
  const input = useRef<HTMLInputElement | null>(null)
  const [caret, setCaret] = useState<Caret | null>(null)
  const pendingSelection = useRef<number | null>(null)
  // A caret that belongs to other text is stale: the draft was reset from the
  // address, say, and nobody has put the caret anywhere in *this* text yet.
  const here = caret?.text === value ? caret.at : null
  const typeahead = useFilterTypeahead({ text: value, caret: here, workspaceId })

  function apply(edit: Edit): void {
    pendingSelection.current = edit.caret
    setCaret({ at: edit.caret, text: edit.text })
    onValueChange(edit.text)
  }

  useImperativeHandle(ref, () => ({
    focus: () => {
      input.current?.focus()
    },
    addFilter: (key) => {
      // An empty token at the end: the new filter never replaces the last word.
      const spaced = value === '' || /\s$/u.test(value) ? value : `${value} `
      apply(acceptSuggestion(spaced, tokenAt(spaced, spaced.length), key, null))
      input.current?.focus()
    },
  }))

  /* Synchronises with the DOM selection, which React does not render: a
     controlled input's caret jumps to the end when its value is set. */
  useLayoutEffect(() => {
    const wanted = pendingSelection.current
    if (wanted === null) return
    pendingSelection.current = null
    input.current?.setSelectionRange(wanted, wanted)
  })

  /* Synchronises with the document's selection: moving the caret with the
     arrow keys or a click changes no value, so no change event says where it is. */
  useEffect(() => {
    function follow(): void {
      const field = input.current
      if (field === null || document.activeElement !== field || field.selectionStart === null) {
        return
      }
      const at = field.selectionStart
      const text = field.value
      setCaret((previous) =>
        previous?.at === at && previous.text === text ? previous : { at, text },
      )
    }
    document.addEventListener('selectionchange', follow)
    return () => {
      document.removeEventListener('selectionchange', follow)
    }
  }, [])

  return (
    <Combobox
      label={label}
      value={value}
      onValueChange={(next) => {
        setCaret({ at: input.current?.selectionStart ?? next.length, text: next })
        onValueChange(next)
      }}
      {...(placeholder === undefined ? {} : { placeholder })}
      groups={typeahead.groups}
      notice={typeahead.notice}
      status={typeahead.status}
      busy={typeahead.busy}
      keepsOpen={typeahead.keepsOpen}
      preselect={false}
      onSelect={(optionId) => {
        const edit = typeahead.accept(optionId)
        if (edit !== undefined) apply(edit)
      }}
      inputRef={input}
      className={className}
    />
  )
}
