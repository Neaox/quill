import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'

import { runAt, useMenuNavigation } from '../menu/use-menu-navigation.ts'
import type { SlashPickerOption, SlashPickerSource } from './slash-item.ts'
import type { MenuPlacement } from './slash-position.ts'
import {
  countMessage,
  placementStyle,
  slashMenuClasses as classes,
  slashMenuStyles,
} from './slash-styles.ts'
import type { SlashPickerState } from './slash-store.ts'

/**
 * An item's second step: a field to type in and a list to choose from, in
 * the menu's place. Here focus does move — into the field, which is a
 * WAI-ARIA combobox — because the author is now answering a question rather
 * than writing. Escape, Backspace in the empty field, or leaving it gives up
 * and puts the caret back where it was, with nothing inserted.
 */

const picker = tv({
  slots: {
    field:
      'w-full border-b border-border bg-transparent px-3 py-2.5 text-sm text-foreground ' +
      'placeholder:text-muted focus:outline-none',
    glyph: 'flex size-8 shrink-0 items-center justify-center text-lg leading-none',
    image: 'size-5 object-contain',
  },
})

const styles = slashMenuStyles()
const own = picker()
const parts = { input: own.field(), glyph: own.glyph(), image: own.image() } as const

/** How long a search waits for the author to stop typing. */
export const SEARCH_DELAY_MS = 120

/** The keys the field lends to the list; the rest edit the text. */
const LIST_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'])

interface SearchResult {
  readonly query: string
  readonly options: readonly SlashPickerOption[]
}

/**
 * The options for a query: a list's straight away, a search's once it
 * answers, with the previous answer shown meanwhile so the list does not
 * blink empty between keystrokes.
 */
function useOptions(source: SlashPickerSource, query: string) {
  const [result, setResult] = useState<SearchResult | null>(null)

  // Runs the application's search — the external system this picker reads —
  // a moment after the author stops typing, and abandons it when they type on.
  useEffect(() => {
    if (source.kind !== 'search') return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      source.search(query, controller.signal).then(
        (options) => {
          if (!controller.signal.aborted) setResult({ query, options })
        },
        () => {
          if (!controller.signal.aborted) setResult({ query, options: [] })
        },
      )
    }, SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [source, query])

  if (source.kind === 'list') return { options: source.options(query), busy: false }
  return { options: result?.options ?? [], busy: result?.query !== query }
}

export interface SlashPickerPanelProps {
  readonly state: SlashPickerState
  readonly placement: MenuPlacement
  readonly className?: string | undefined
}

export function SlashPickerPanel({ state, placement, className }: SlashPickerPanelProps) {
  const baseId = useId()
  const listId = `${baseId}-list`
  const field = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const { options, busy } = useOptions(state.picker.source, query)

  const select = useCallback(
    (index: number) => {
      runAt(
        options.map((option) => () => {
          state.choose(option)
        }),
        index,
      )
    },
    [options, state],
  )

  const { activeIndex, setActiveIndex, handleKey } = useMenuNavigation({
    count: options.length,
    onSelect: select,
    onDismiss: state.cancel,
  })

  // Moves focus into the field when the picker opens: the browser's focus is
  // the external system here, and the picker is where the author now types.
  useEffect(() => {
    field.current?.focus()
  }, [])

  const activeId = activeIndex < 0 ? undefined : `${baseId}-${String(activeIndex)}`

  // Keeps the option the arrows reach in view inside the scrolling list.
  useEffect(() => {
    if (activeId !== undefined)
      document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return (
    <div
      className={styles.root({ class: className })}
      style={placementStyle(placement)}
      data-side={placement.side}
      data-sheet={placement.sheet || undefined}
      onBlur={(event) => {
        // Leaving the picker is giving up; moving within it is not.
        if (!event.currentTarget.contains(event.relatedTarget)) state.cancel()
      }}
    >
      <label htmlFor={`${baseId}-field`} className={classes.heading}>
        {state.picker.title}
      </label>
      <input
        ref={field}
        id={`${baseId}-field`}
        type="text"
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={options.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-busy={busy}
        autoComplete="off"
        spellCheck={false}
        placeholder={state.picker.placeholder}
        className={parts.input}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Backspace' && query === '') {
            event.preventDefault()
            state.cancel()
            return
          }
          if (LIST_KEYS.has(event.key) && handleKey(event.key)) event.preventDefault()
        }}
      />
      {options.length === 0 ? null : (
        <div id={listId} role="listbox" aria-label={state.picker.title} className={classes.list}>
          {options.map((option, index) => (
            <div
              key={option.id}
              id={`${baseId}-${String(index)}`}
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              data-active={index === activeIndex || undefined}
              className={classes.option}
              onMouseMove={
                index === activeIndex
                  ? undefined
                  : () => {
                      setActiveIndex(index)
                    }
              }
              onMouseDown={(event) => {
                // Chosen on press, with the focus kept in the field, so
                // choosing is not also leaving.
                event.preventDefault()
                state.choose(option)
              }}
            >
              {option.glyph === undefined ? null : (
                <span className={parts.glyph} aria-hidden="true">
                  {option.glyph}
                </span>
              )}
              {option.image === undefined ? null : (
                <span className={parts.glyph}>
                  <img src={option.image} alt="" className={parts.image} />
                </span>
              )}
              <span className={classes.text}>
                <span className={classes.label}>{option.label}</span>
                {option.description === undefined ? null : (
                  <span className={classes.description}>{option.description}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {options.length === 0 && !busy ? (
        <p className={classes.empty}>{state.picker.empty(query)}</p>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {busy ? 'Searching' : countMessage(options.length, 'result')}
      </p>
    </div>
  )
}
