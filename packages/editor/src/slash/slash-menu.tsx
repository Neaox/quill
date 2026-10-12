import type { Editor } from '@tiptap/react'
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'

import { nextIndex, runAt, useMenuNavigation } from '../menu/use-menu-navigation.ts'
import type { SlashItem } from './slash-item.ts'
import { SlashPickerPanel } from './slash-picker.tsx'
import { currentViewport, placeMenu } from './slash-position.ts'
import { highlight } from './slash-rank.ts'
import type { RankedMatch } from './slash-rank.ts'
import { flatten } from './slash-sections.ts'
import { useWindowedList } from './windowed-list.ts'
import type { SlashMenuState, SlashStore } from './slash-store.ts'
import {
  BLOCK_WORDING,
  placementStyle,
  slashMenuClasses as classes,
  slashMenuStyles,
  HEADING_REM,
  HEADING_STYLE,
  LIST_PADDING,
  OPTION_REM,
  OPTION_STYLE,
  rootFontSize,
  windowStyle,
} from './slash-styles.ts'

/**
 * The insert menu the slash key opens.
 *
 * It is a listbox the caret drives: focus stays in the document, so the
 * document's own element carries the active option (`aria-activedescendant`)
 * and names the list it controls, and the keys arrive through the suggestion
 * plugin. A screen reader hears the option the arrows land on, and hears how
 * many blocks match, politely, as the list narrows. A chosen item that needs
 * more — a language, a document — turns the menu into its picker in place.
 */

const styles = slashMenuStyles()

export interface SlashMenuProps {
  readonly store: SlashStore
  readonly editor: Editor | null
  readonly className?: string
}

export function SlashMenu({ store, editor, className }: SlashMenuProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  if (snapshot.mode === 'closed') return null
  if (snapshot.mode === 'picker') {
    return (
      <SlashPickerPanel
        state={snapshot}
        placement={placeMenu(snapshot.rect, currentViewport())}
        className={className}
      />
    )
  }
  return (
    <SlashList
      key={snapshot.query}
      state={snapshot}
      store={store}
      editor={editor}
      className={className}
    />
  )
}

interface SlashListProps {
  readonly state: SlashMenuState
  readonly store: SlashStore
  readonly editor: Editor | null
  readonly className?: string | undefined
}

/** The height of each row is fixed, in rem, so the list can be windowed by arithmetic (`windowed-list.ts`). */

type Row =
  | { readonly kind: 'heading'; readonly section: number }
  | {
      readonly kind: 'option'
      readonly section: number
      readonly index: number
      readonly match: RankedMatch<SlashItem>
    }

/** The sections as rows: a heading where a section has a title, then its options. */
function rowsOf(sections: SlashMenuState['sections']): readonly Row[] {
  let index = -1
  return sections.flatMap((section, at): Row[] => [
    ...(section.title === null ? [] : [{ kind: 'heading' as const, section: at }]),
    ...section.matches.map((match) => {
      index += 1
      return { kind: 'option' as const, section: at, index, match }
    }),
  ])
}

function SlashList({ state, store, editor, className }: SlashListProps) {
  const wording = state.wording ?? BLOCK_WORDING
  const baseId = useId()
  const listId = `${baseId}-list`
  const matches = flatten(state.sections)
  const distinct = new Set(matches.map(({ item }) => item.id)).size
  const rows = useMemo(() => rowsOf(state.sections), [state.sections])
  // The rows' heights in pixels, from the root font size at the moment the menu
  // opened: a rem is a multiple of it, and nothing else about a row's height varies.
  const [pixelsPerRem] = useState(rootFontSize)
  const heights = useMemo(
    () => rows.map((row) => (row.kind === 'heading' ? HEADING_REM : OPTION_REM) * pixelsPerRem),
    [rows, pixelsPerRem],
  )
  const placement = placeMenu(state.rect, currentViewport())
  const { listRef, window, onScroll, revealRows } = useWindowedList(
    heights,
    placement.maxHeight,
    LIST_PADDING,
  )

  const select = useCallback(
    (index: number) => {
      runAt(
        matches.map(({ item }) => () => {
          state.apply(item)
        }),
        index,
      )
    },
    [matches, state],
  )

  const { activeIndex, setActiveIndex, handleKey } = useMenuNavigation({
    count: matches.length,
    onSelect: select,
    onDismiss: store.close,
  })

  // The keyboard moves the list to the option it lands on; the pointer
  // never does, so the list does not jump under it.
  const handleListKey = useCallback(
    (key: string): boolean => {
      const moved = nextIndex(activeIndex, matches.length, key)
      if (moved !== null) {
        const row = rows.findIndex((entry) => entry.kind === 'option' && entry.index === moved)
        // The first option of a group is shown with its heading.
        const headed = rows.slice(row - 1, row).some((entry) => entry.kind === 'heading')
        revealRows(headed ? row - 1 : row, row)
      }
      return handleKey(key)
    },
    [activeIndex, matches.length, revealRows, rows, handleKey],
  )

  // Wires this menu's key handling into the external SlashStore so the
  // ProseMirror suggestion plugin — which owns the keydown outside React — can
  // route keys to whichever item is active.
  useEffect(() => {
    store.setKeyHandler(handleListKey)
    return () => {
      store.setKeyHandler(null)
    }
  }, [store, handleListKey])

  const visible = rows.slice(window.start, window.end)
  // Named only while it is drawn: scrolled out of the window it is not in the
  // document, and a reference to nothing is worse than none. The keyboard
  // brings it back into view before it moves.
  const activeDrawn = visible.some((row) => row.kind === 'option' && row.index === activeIndex)
  const activeId = activeDrawn ? `${baseId}-${String(activeIndex)}` : null

  // The active-descendant state belongs on the element that holds focus, which
  // is the document itself; ProseMirror owns that element, so it is set here by
  // hand, with `aria-controls` naming the list. `role="textbox"` admits both;
  // `aria-expanded` belongs to `combobox`, which a multi-line document is not.
  useEffect(() => {
    const dom = editor?.view.dom
    if (dom === undefined) return
    if (activeId === null) return
    dom.setAttribute('aria-activedescendant', activeId)
    dom.setAttribute('aria-controls', listId)
    return () => {
      dom.removeAttribute('aria-activedescendant')
      dom.removeAttribute('aria-controls')
    }
  }, [editor, activeId, listId])

  const option = (row: Extract<Row, { kind: 'option' }>) => (
    <SlashOption
      key={`${String(row.index)}-${row.match.item.id}`}
      id={`${baseId}-${String(row.index)}`}
      item={row.match.item}
      ranges={row.match.ranges}
      position={row.index + 1}
      count={matches.length}
      active={row.index === activeIndex}
      onActivate={() => {
        setActiveIndex(row.index)
      }}
      onChoose={() => {
        state.apply(row.match.item)
      }}
    />
  )

  return (
    <div
      className={styles.root({ class: className })}
      style={placementStyle(placement)}
      data-side={placement.side}
      data-sheet={placement.sheet || undefined}
    >
      {matches.length === 0 ? (
        <p className={classes.empty}>{wording.empty(state.query.trim())}</p>
      ) : (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={wording.name}
          className={classes.list}
          onScroll={onScroll}
        >
          {/* The rows' own space, above and below, lives in a box *inside* the
              scroller. As padding on the scroller itself it was a floor under
              its height — a box cannot be shorter than its padding — so the
              list grew to the height of the whole catalogue, the menu clipped
              it, and the last blocks could not be scrolled to. */}
          <div style={windowStyle(window)}>
            {state.sections.map((section, sectionIndex) => {
              const shown = visible.filter((row) => row.section === sectionIndex)
              if (shown.length === 0) return null
              const options = shown.flatMap((row) => (row.kind === 'option' ? [option(row)] : []))
              if (section.title === null) return <Fragment key="matches">{options}</Fragment>
              const headingId = `${baseId}-group-${String(sectionIndex)}`
              // A heading scrolled out of the window is kept only as the group's name, for
              // assistive technology (`sr-only`); its height is already in the space above.
              const headingDrawn = shown[0]?.kind === 'heading'
              return (
                <div key={section.title} role="group" aria-labelledby={headingId}>
                  {/* Named even while scrolled out of the window, so the group keeps its name. */}
                  <div
                    id={headingId}
                    role="presentation"
                    data-offscreen={!headingDrawn || undefined}
                    className={classes.heading}
                    style={headingDrawn ? HEADING_STYLE : undefined}
                  >
                    {section.title}
                  </div>
                  {options}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {wording.count(distinct)}
      </p>
    </div>
  )
}

interface SlashOptionProps {
  readonly id: string
  readonly item: SlashItem
  /** Its place in the whole list, which is windowed, so a screen reader can say "3 of 40". */
  readonly position: number
  readonly count: number
  readonly ranges: RankedMatch<SlashItem>['ranges']
  readonly active: boolean
  onActivate(): void
  onChoose(): void
}

function SlashOption({
  id,
  item,
  ranges,
  position,
  count,
  active,
  onActivate,
  onChoose,
}: SlashOptionProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-posinset={position}
      aria-setsize={count}
      tabIndex={-1}
      data-active={active || undefined}
      data-group={item.group}
      className={classes.option}
      style={OPTION_STYLE}
      onMouseMove={active ? undefined : onActivate}
      onMouseDown={(event) => {
        // Chosen on press, and the press kept from the document, which must
        // keep the selection the item is about to act on. A finger that
        // scrolls the list sends no press, so scrolling never chooses.
        event.preventDefault()
        onChoose()
      }}
    >
      <span className={classes.icon}>
        <ItemMark item={item} />
      </span>
      <span className={classes.text}>
        <span className={classes.label}>
          {highlight(item.label, ranges).map((part) =>
            part.matched ? (
              <mark key={part.start} className={classes.mark}>
                {part.text}
              </mark>
            ) : (
              <Fragment key={part.start}>{part.text}</Fragment>
            ),
          )}
        </span>
        <span className={classes.description}>{item.description}</span>
      </span>
      {item.shortcut === undefined ? null : <kbd className={classes.kbd}>{item.shortcut}</kbd>}
    </div>
  )
}

/**
 * What stands before an item's label. An emoji's character or picture is
 * decoration: the words beside it are what is read, and say what it is.
 */
function ItemMark({ item }: { readonly item: SlashItem }) {
  if (item.glyph !== undefined) return <span aria-hidden="true">{item.glyph}</span>
  if (item.image !== undefined) return <img src={item.image} alt="" className={classes.image} />
  const Icon = item.icon
  return Icon === undefined ? null : <Icon />
}
