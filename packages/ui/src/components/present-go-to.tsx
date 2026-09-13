import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { tv } from '../lib/class-names.ts'
import { Button } from './button.tsx'

export const presentGoToStyles = tv({
  slots: {
    root: [
      'present-go-to fixed inset-0 z-50 m-0 flex h-full w-full max-h-none max-w-none',
      'border-0 bg-overlay p-8 text-foreground',
    ],
    panel: [
      'm-auto flex max-h-full w-[min(40rem,calc(100vw-4rem))] flex-col gap-3 rounded-lg',
      'border border-border bg-surface-raised p-5 shadow-dialog',
    ],
    header: 'flex items-center justify-between gap-4',
    title: 'text-base leading-snug font-semibold tracking-tight text-foreground',
    filter: [
      'h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground',
      'placeholder:text-muted focus-visible:border-border-strong focus-visible:outline-2',
      'focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
    ],
    list: 'flex min-h-0 flex-col gap-0.5 overflow-y-auto',
    option: [
      'flex w-full cursor-pointer items-baseline gap-3 rounded-md px-3 py-2 text-start',
      'text-sm text-foreground aria-selected:bg-surface aria-current:font-medium',
    ],
    ordinal: 'w-6 shrink-0 font-mono text-2xs text-muted tabular-nums',
    empty: 'px-3 py-6 text-center text-sm text-muted',
  },
})

export interface PresentGoToSection {
  readonly id: string
  readonly title: string
}

export interface MatchedSection extends PresentGoToSection {
  /** Where the section sits in the presentation, counted from zero. */
  readonly index: number
}

/**
 * The sections a typed query names, in document order.
 *
 * Two things match, because those are the two ways a presenter refers to a
 * section under pressure: any part of its title, case-insensitively, and its
 * number in the presentation. An empty query matches everything, so the
 * overlay opens showing the whole document rather than nothing.
 */
export function matchingSections(
  sections: readonly PresentGoToSection[],
  query: string,
): readonly MatchedSection[] {
  const needle = query.trim().toLocaleLowerCase()
  return sections
    .map((section, index) => ({ ...section, index }))
    .filter(
      (section) =>
        needle === '' ||
        section.title.toLocaleLowerCase().includes(needle) ||
        String(section.index + 1) === needle,
    )
}

export interface PresentGoToProps extends OverlayProps {
  /**
   * Closed renders nothing at all, rather than a hidden panel: the filter and
   * the active option are the overlay's own state, and mounting it fresh is
   * what makes every opening start from the whole list again.
   */
  readonly open: boolean
}

interface OverlayProps {
  readonly sections: readonly PresentGoToSection[]
  /** The section being presented, counted from zero. */
  readonly currentIndex: number
  readonly onSelect: (index: number) => void
  readonly onClose: () => void
  readonly title?: string
}

/** The focusable controls inside the panel, in tab order. */
function focusableWithin(root: HTMLElement | null): readonly HTMLElement[] {
  // `moveFocus` only ever calls this with `panel.current`, which is set once
  // the dialog mounts and stays set for as long as a key event can reach it.
  /* v8 ignore next */
  if (root === null) return []
  return [...root.querySelectorAll<HTMLElement>('input, button:not([tabindex="-1"])')].filter(
    (element) => !element.hasAttribute('disabled'),
  )
}

/**
 * "Go to": the overlay that lists a presentation's sections and jumps to one
 * (quill-plan.md section 14).
 *
 * The combobox-and-listbox pattern rather than a list of buttons: the filter
 * keeps focus while the arrow keys move `aria-activedescendant` through the
 * matches, so a presenter types a word and presses Enter without ever leaving
 * the field. Options are deliberately not tab stops for the same reason — a
 * fifty-section document would otherwise be fifty presses deep.
 *
 * A real `<dialog>`, but opened by its `open` attribute rather than
 * `showModal()`: the presentation surface is already the whole screen, so the
 * top layer buys nothing here, and the attribute form behaves identically in
 * every environment. What `showModal` would have given — a focus trap,
 * Escape, and a modal announcement — is the Tab handler below, the key map,
 * and `aria-modal`.
 */
export function PresentGoTo({ open, ...overlay }: PresentGoToProps) {
  return open ? <GoToOverlay {...overlay} /> : undefined
}

function GoToOverlay({
  sections,
  currentIndex,
  onSelect,
  onClose,
  title = 'Go to a section',
}: OverlayProps) {
  const ids = useId()
  const panel = useRef<HTMLDivElement | null>(null)
  const filter = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [wanted, setWanted] = useState(0)

  const matches = matchingSections(sections, query)
  // Derived rather than corrected in an effect: a query that shortens the list
  // moves the active option to its end on the very render that shortened it.
  const active = matches.length === 0 ? -1 : Math.min(wanted, matches.length - 1)
  const activeId = active === -1 ? undefined : `${ids}-option-${active}`

  /* Synchronises with the DOM's focus, which React does not render: an
     overlay a presenter opened with `g` has to be typeable into without a
     further gesture. It runs once, when the overlay mounts. */
  useEffect(() => {
    filter.current?.focus()
  }, [])

  /* Synchronises with the list's scroll position: moving through
     `aria-activedescendant` never scrolls on its own, because nothing is
     focused but the field. */
  useEffect(() => {
    if (activeId === undefined) return
    panel.current?.ownerDocument.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const styles = presentGoToStyles()

  function move(by: number): void {
    if (matches.length === 0) return
    setWanted(Math.min(matches.length - 1, Math.max(0, active + by)))
  }

  function choose(): void {
    const chosen = matches[active]
    if (chosen !== undefined) onSelect(chosen.index)
  }

  function moveFocus(from: EventTarget, by: number): void {
    const stops = focusableWithin(panel.current)
    // The filter and the Close button are always rendered, so `stops` is
    // never empty.
    /* v8 ignore next */
    if (stops.length === 0) return
    // `from` is `event.target`, typed as the broad `EventTarget` React gives
    // every event, but a real key event's target here is always the DOM
    // element that had focus, so always one of `stops`' `HTMLElement`s.
    /* v8 ignore next */
    const at = from instanceof HTMLElement ? stops.indexOf(from) : -1
    stops.at((at + by) % stops.length)?.focus()
  }

  /**
   * Every key the overlay understands is consumed here, so none of them reach
   * the presentation's own map: `g` is a letter in the filter, Escape closes
   * the overlay rather than the presentation, and the arrows move the active
   * option rather than the slide.
   */
  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'Home') setWanted(0)
    else if (event.key === 'End') move(matches.length)
    else if (event.key === 'Enter') choose()
    else if (event.key === 'Escape') onClose()
    else if (event.key === 'Tab') moveFocus(event.target, event.shiftKey ? -1 : 1)
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby={`${ids}-title`}
      onKeyDown={onKeyDown}
      className={styles.root()}
    >
      <div ref={panel} className={styles.panel()}>
        <div className={styles.header()}>
          <h2 id={`${ids}-title`} className={styles.title()}>
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <input
          ref={filter}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${ids}-list`}
          aria-label="Filter sections"
          {...(activeId === undefined ? {} : { 'aria-activedescendant': activeId })}
          placeholder="Type to filter sections"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setWanted(0)
          }}
          className={styles.filter()}
        />

        <div id={`${ids}-list`} role="listbox" aria-label={title} className={styles.list()}>
          {matches.map((section, position) => (
            <button
              key={section.id}
              id={`${ids}-option-${position}`}
              type="button"
              role="option"
              // Not a tab stop: the filter keeps focus and moves
              // `aria-activedescendant`, so Tab stays a way out of the panel
              // rather than a walk through every section in the document.
              tabIndex={-1}
              aria-selected={position === active}
              aria-current={section.index === currentIndex ? 'true' : undefined}
              onClick={() => onSelect(section.index)}
              className={styles.option()}
            >
              <span className={styles.ordinal()}>{section.index + 1}</span>
              <span>{section.title}</span>
            </button>
          ))}
        </div>

        {matches.length === 0 ? (
          <p className={styles.empty()}>No section matches “{query}”.</p>
        ) : undefined}
      </div>
    </dialog>
  )
}
