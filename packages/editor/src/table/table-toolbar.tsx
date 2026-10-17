import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  CaptionIcon,
  ChevronDownIcon,
  ColumnLeftIcon,
  ColumnRightIcon,
  DeleteColumnIcon,
  DeleteRowIcon,
  FooterRowIcon,
  HeaderColumnIcon,
  HeaderRowIcon,
  MenuButton,
  RowAboveIcon,
  RowBelowIcon,
  TableOptionsIcon,
  Tooltip,
  TooltipProvider,
  TrashIcon,
  WidthIcon,
  buttonClassName,
  tv,
} from '@quill/ui'
import type { MenuSection } from '@quill/ui'
import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import { pageLayoutFrame } from '../document/measuring.ts'
import { isApplePlatform, shortcutLabel } from '../format/shortcuts.ts'
import { describeTable, resolveAction, TABLE_ACTIONS } from './table-actions.ts'
import type { ResolvedTableAction, TableState } from './table-actions.ts'
import { setTableAttribute } from './table-commands.ts'

/**
 * The table toolbar (ADR-040, phase 2): one compact row of the table's
 * actions (`table-actions.ts`) under the table the caret is in, as
 * Confluence's is, so it never covers the caption or the header row being
 * written.
 *
 * One `role="toolbar"`: Tab reaches it once, the arrow keys move along it,
 * Escape goes back to the cell. Every control names itself in words, shows
 * its shortcut in its tooltip, and runs one command, so one undo step. A
 * control that cannot act on this table now stays where it is, disabled with
 * its reason in the tooltip (`docs/design/feedback.md`, "Disable or hide").
 * While the table runs past the bottom of the screen, the toolbar waits at
 * the bottom of the screen until the table's end scrolls into view.
 *
 * Inside a table this toolbar is the one shown: the selection toolbar
 * (`format/selection-toolbar.tsx`) stands aside there.
 */

const toolbarStyles = tv({
  slots: {
    root: [
      'table-toolbar absolute top-(--table-toolbar-top) left-(--table-toolbar-left) z-20 flex items-center gap-0.5 overflow-x-auto',
      // Ends inside the editor however far in it starts; on a phone it scrolls sideways.
      'max-w-[calc(100%-var(--table-toolbar-left,0px)-0.5rem)]',
      'rounded-md border border-border bg-surface-raised p-0.5 shadow-raised',
    ],
    group: 'flex shrink-0 items-center gap-0.5',
    separator: 'mx-0.5 h-5 w-px shrink-0 bg-border',
    icon: [
      'size-7 px-0 text-foreground-soft',
      'aria-pressed:bg-accent-subtle aria-pressed:text-foreground',
      'aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent',
      'data-[tone=danger]:hover:text-danger',
    ],
    menu: 'h-7 gap-1 px-1.5 text-xs',
    tip: 'flex items-center gap-2',
    keys: 'font-mono text-2xs text-muted',
  },
})

const styles = toolbarStyles()

const ICONS: Readonly<Record<string, ReactNode>> = {
  'row-above': <RowAboveIcon />,
  'row-below': <RowBelowIcon />,
  'column-left': <ColumnLeftIcon />,
  'column-right': <ColumnRightIcon />,
  'delete-row': <DeleteRowIcon />,
  'delete-column': <DeleteColumnIcon />,
  'header-row': <HeaderRowIcon />,
  'header-column': <HeaderColumnIcon />,
  'footer-row': <FooterRowIcon />,
  caption: <CaptionIcon />,
  'align-left': <AlignLeftIcon />,
  'align-center': <AlignCenterIcon />,
  'align-right': <AlignRightIcon />,
  'delete-table': <TrashIcon />,
}

/** The icon buttons, in their groups, by action id. */
const GROUPS: readonly { readonly label: string; readonly ids: readonly string[] }[] = [
  { label: 'Parts', ids: ['header-row', 'header-column', 'footer-row', 'caption'] },
  { label: 'Column alignment', ids: ['align-left', 'align-center', 'align-right'] },
  {
    label: 'Rows and columns',
    ids: ['row-above', 'row-below', 'column-left', 'column-right', 'delete-row', 'delete-column'],
  },
]

/** The `freeze` attribute for each choice in the reading menu. */
const FREEZE_VALUES: Readonly<Record<string, string | undefined>> = {
  none: undefined,
  header: 'header',
  'first-column': 'first-column',
  both: 'header,first-column',
}

const WIDTH_LABELS: Readonly<Record<TableState['width'], string>> = {
  content: 'Content',
  wide: 'Wide',
  full: 'Full',
  custom: 'Custom',
}

/** The table actions by id, for the table the caret is in. */
function resolved(table: TableState): ReadonlyMap<string, ResolvedTableAction> {
  return new Map(TABLE_ACTIONS.map((action) => [action.id, resolveAction(action, table)]))
}

/** A binding as `aria-keyshortcuts` writes it: `Mod-Alt-ArrowUp` is `Control+Alt+ArrowUp`, or `Meta+…` on Apple. */
export function ariaKeyShortcut(binding: string, apple: boolean): string {
  return binding.replace(/^Mod(?=-)/u, apple ? 'Meta' : 'Control').replaceAll('-', '+')
}

export interface TableToolbarProps {
  readonly editor: Editor | null
}

/** Where the toolbar sits: under the table, or at the bottom of the screen while the table runs past it. */
export function placement(
  table: DOMRect,
  container: DOMRect,
  height: number,
  viewport: number,
): { readonly top: number; readonly left: number } {
  const gap = 8
  const under = table.bottom + gap
  const lowest = viewport - height - gap
  const top = Math.max(Math.min(under, lowest), table.top + gap)
  return { top: top - container.top, left: Math.max(0, table.left - container.left) }
}

export function TableToolbar({ editor }: TableToolbarProps) {
  const table = useEditorState({
    editor,
    selector: ({ editor: current }) => (current === null ? null : describeTable(current.state)),
    equalityFn: (a, b) => a?.key === b?.key,
  })
  const root = useRef<HTMLDivElement | null>(null)
  const apple = isApplePlatform()

  /* Synchronises the toolbar's position with the page's scroll, the
     window's size and the document's changes, which React does not render.
     It is written as two custom properties, through the CSSOM, as the
     Content-Security-Policy allows (ADR-011). */
  useEffect(() => {
    if (editor === null || table === null) return undefined
    // Measured in the page's layout frame, with the table's handles, so the
    // two read the layout once between them (`document/measuring.ts`).
    const frame = pageLayoutFrame()
    const owner = {}
    const place = (): void => {
      frame.schedule(owner, () => {
        const toolbar = root.current
        const node = editor.view.nodeDOM(table.tablePos)
        /* v8 ignore start -- the toolbar is mounted beside the table it follows, which has its card. */
        // The card: the wrapper's, or a bare table's own.
        const card = node instanceof HTMLElement ? node.closest('.table-block') : null
        const container = toolbar?.parentElement
        if (toolbar == null || container == null || card === null) return undefined
        /* v8 ignore stop */
        const { top, left } = placement(
          card.getBoundingClientRect(),
          container.getBoundingClientRect(),
          toolbar.offsetHeight,
          window.innerHeight,
        )
        return () => {
          toolbar.style.setProperty('--table-toolbar-top', `${String(top)}px`)
          toolbar.style.setProperty('--table-toolbar-left', `${String(left)}px`)
        }
      })
    }
    place()
    window.addEventListener('scroll', place, { passive: true, capture: true })
    window.addEventListener('resize', place, { passive: true })
    editor.on('update', place)
    return () => {
      frame.cancel(owner)
      window.removeEventListener('scroll', place, { capture: true })
      window.removeEventListener('resize', place)
      editor.off('update', place)
    }
  }, [editor, table])

  /* One tab stop: the menus' triggers are Radix's buttons, so the roving
     tab index is set on the rendered buttons rather than as a prop. */
  useLayoutEffect(() => {
    const buttons = root.current?.querySelectorAll('button') ?? []
    buttons.forEach((button, index) => {
      button.tabIndex = index === 0 ? 0 : -1
    })
  })

  if (editor === null || table === null) return null
  const actions = resolved(table)

  const run = (action: ResolvedTableAction): void => {
    if (action.unavailable !== undefined) return
    action.command(editor.state, editor.view.dispatch)
    editor.view.focus()
  }

  /* The arrow keys move along the toolbar, Escape goes back to the table. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      editor.view.focus()
      return
    }
    const buttons = [...event.currentTarget.querySelectorAll('button')]
    const index = buttons.findIndex((button) => button === document.activeElement)
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: buttons.length - 1 - index }[
      event.key
    ]
    if (step === undefined || index === -1) return
    event.preventDefault()
    buttons[(index + step + buttons.length) % buttons.length]?.focus()
  }

  const iconButton = (id: string, tone?: 'danger'): ReactNode => {
    const action = actions.get(id)
    /* v8 ignore next -- every id the toolbar draws is in the catalogue. */
    if (action === undefined) return null
    const keys = action.key === undefined ? undefined : shortcutLabel(action.key, apple)
    return (
      <Tooltip
        key={id}
        side="bottom"
        content={
          <span className={styles.tip()}>
            <span>{action.unavailable ?? action.label}</span>
            {keys === undefined || action.unavailable !== undefined ? null : (
              <kbd className={styles.keys()}>{keys}</kbd>
            )}
          </span>
        }
      >
        <button
          type="button"
          aria-label={action.label}
          aria-pressed={action.pressed}
          aria-disabled={action.unavailable === undefined ? undefined : true}
          aria-keyshortcuts={
            action.key === undefined ? undefined : ariaKeyShortcut(action.key, apple)
          }
          data-control={id}
          data-tone={tone}
          className={buttonClassName({ variant: 'ghost', size: 'sm', className: styles.icon() })}
          onClick={() => {
            run(action)
          }}
        >
          {ICONS[id]}
        </button>
      </Tooltip>
    )
  }

  const setAttribute = (name: string, value: string | undefined): void => {
    setTableAttribute(name, value)(editor.state, editor.view.dispatch)
  }

  const widthSections: readonly MenuSection[] = [
    {
      id: 'width',
      entries: [
        {
          kind: 'choice',
          label: 'Table width',
          value: table.width,
          options: [
            { value: 'content', label: 'Content: the text column' },
            { value: 'wide', label: 'Wide: past the text' },
            { value: 'full', label: 'Full: the whole page' },
          ],
          onValueChange: (value) => {
            setAttribute('width', value === 'wide' ? undefined : value)
          },
        },
      ],
    },
  ]

  const freeze =
    table.freezeHeader && table.freezeColumn
      ? 'both'
      : table.freezeHeader
        ? 'header'
        : table.freezeColumn
          ? 'first-column'
          : 'none'
  const readingSections: readonly MenuSection[] = [
    {
      id: 'reading',
      label: 'How readers see it',
      entries: [
        {
          kind: 'choice',
          label: 'Keep in view while scrolling',
          value: freeze,
          options: [
            { value: 'none', label: 'As the table needs' },
            { value: 'header', label: 'Header row' },
            { value: 'first-column', label: 'First column' },
            { value: 'both', label: 'Header row and first column' },
          ],
          onValueChange: (value) => {
            setAttribute('freeze', FREEZE_VALUES[value])
          },
        },
        {
          kind: 'choice',
          label: 'On a phone',
          value: table.stack ? 'stack' : 'scroll',
          options: [
            { value: 'scroll', label: 'Scroll sideways' },
            { value: 'stack', label: 'A card for each row' },
          ],
          onValueChange: (value) => {
            setAttribute('responsive', value === 'stack' ? 'stack' : undefined)
          },
        },
        {
          kind: 'choice',
          label: 'Sorting',
          value: table.sortable ? 'on' : 'off',
          options: [
            { value: 'on', label: 'Readers can sort by a column' },
            { value: 'off', label: 'Keep the written order' },
          ],
          onValueChange: (value) => {
            setAttribute('sort', value === 'off' ? 'off' : undefined)
          },
        },
      ],
    },
  ]

  return (
    <TooltipProvider>
      <div
        ref={root}
        role="toolbar"
        aria-label="Table"
        className={styles.root()}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => {
          // Pressing a button keeps the caret in the cell the command acts on.
          event.preventDefault()
        }}
      >
        <MenuButton
          label={`Width: ${WIDTH_LABELS[table.width]}`}
          sections={widthSections}
          align="start"
        >
          <WidthIcon />
          <span className="text-xs">{WIDTH_LABELS[table.width]}</span>
          <ChevronDownIcon className="size-3" />
        </MenuButton>
        {GROUPS.map((group) => (
          <div key={group.label} role="group" aria-label={group.label} className={styles.group()}>
            <span aria-hidden="true" className={styles.separator()} />
            {group.ids.map((id) => iconButton(id))}
          </div>
        ))}
        <span aria-hidden="true" className={styles.separator()} />
        <MenuButton label="Reading options" sections={readingSections} align="end">
          <TableOptionsIcon />
          <ChevronDownIcon className="size-3" />
        </MenuButton>
        <span aria-hidden="true" className={styles.separator()} />
        {iconButton('delete-table', 'danger')}
      </div>
    </TooltipProvider>
  )
}
