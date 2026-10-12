import { useState, type DragEvent, type ReactNode } from 'react'

import { Button, PlusIcon, tv, type MenuItem } from '@quill/ui'

import {
  usePublicMenuTargets,
  type PublicMenu,
  type PublicMenuItem,
  type PublicMenuLink,
} from '../../../lib/api/index.ts'
import {
  appendGroup,
  appendLink,
  canMoveTo,
  displayLabel,
  groupsOf,
  itemAt,
  MAX_GROUP_LINKS,
  MAX_MENU_ITEMS,
  menuTargetIds,
  moveBy,
  moveTo,
  removeAt,
  replaceAt,
  type MenuDestination,
  type MenuPosition,
} from './menu-model.ts'
import { MenuPreview } from './menu-preview.tsx'
import {
  GroupRow,
  LinkRow,
  type RowActions,
  type RowDrag,
  type RowOpening,
  type TargetLookup,
} from './menu-rows.tsx'
import { MenuTargetPicker } from './menu-target-picker.tsx'
import { useStableKeys, type StableKeys } from './use-stable-keys.ts'

const editorStyles = tv({
  slots: {
    root: 'flex flex-col gap-5',
    /** The builder reads as a form, so it keeps a form's measure; the preview is as wide as a header. */
    builder: 'flex max-w-(--layout-content) flex-col gap-3',
    list: 'flex flex-col gap-px',
    hint: 'text-2xs text-muted',
    empty: [
      'flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-4 py-5',
      'text-xs text-muted',
    ],
    composer: 'flex items-end gap-2 [&>*:first-child]:grow',
  },
})

export interface PublicMenuEditorProps {
  readonly menu: PublicMenu
  readonly onMenuChange: (menu: PublicMenu) => void
  /** The organisation's name, for the preview's lockup. */
  readonly siteName: string
}

/** Where a drag would land, and how the row under the pointer says so. */
interface DropIndicator {
  readonly key: string
  readonly where: 'before' | 'after' | 'inside'
  readonly to: MenuDestination
}

/** Where the new-link composer is open: the end of the menu, or the end of dropdown `index`. */
type Composer = { readonly group: number | null } | null

/**
 * The public menu builder (ADR-034; `docs/architecture/api-contract-settings.md`).
 *
 * The menu is a list of links and dropdowns. A link is added by choosing what
 * it points at first — a document or collection by search, or an address —
 * so there is never a half-made link in the draft. Each item is one compact
 * row that opens into its fields, one at a time (`menu-rows.tsx`); a label
 * left empty is the target's current title. Items are reordered by dragging
 * the handle, by Alt with an arrow on a focused row, or from its "⋯" menu,
 * which also moves a link into or out of a dropdown.
 *
 * Every document and collection the draft names is looked up in one request,
 * keyed by the set of ids, so the row can say what it is called now and
 * whether a reader will see it — and say plainly when it has been deleted,
 * with the control to repoint it right there.
 */
export function PublicMenuEditor({ menu, onMenuChange, siteName }: PublicMenuEditorProps) {
  const styles = editorStyles()
  const keys = useStableKeys('menu-item')
  const targets = usePublicMenuTargets(menuTargetIds(menu))
  const lookup: TargetLookup =
    targets.error !== null ? 'failed' : targets.isPending ? 'loading' : 'ready'
  const [composer, setComposer] = useState<Composer>(null)
  const [dragged, setDragged] = useState<MenuPosition | null>(null)
  const [indicator, setIndicator] = useState<DropIndicator | null>(null)
  // One row open at a time, by its key: opening another closes this one.
  const [openKey, setOpenKey] = useState<string | null>(null)

  function openingFor(key: string): RowOpening {
    return {
      open: openKey === key,
      onOpenChange: (open) => {
        setOpenKey(open ? key : null)
      },
    }
  }

  /** Commits a new menu, keeping each edited row's key so its field keeps focus. */
  function change(next: PublicMenu, edited?: readonly [object, object]): void {
    if (edited !== undefined) keys.carry(edited[0], edited[1])
    carryGroupKeys(menu, next, keys)
    onMenuChange(next)
  }

  function nameOf(item: PublicMenuItem): string {
    if (item.kind === 'group') return item.label === '' ? 'this dropdown' : item.label
    const target = item.kind === 'url' ? undefined : targets.byId.get(item.id)
    return displayLabel(item, target) ?? 'this link'
  }

  function actionsFor(position: MenuPosition, item: PublicMenuItem): RowActions {
    const siblings = position.child === undefined ? menu.length : groupLength(menu, position.index)
    const own = position.child ?? position.index
    const name = nameOf(item)
    const more: MenuItem[] = []
    if (item.kind !== 'group') {
      if (position.child !== undefined) {
        more.push({
          label: 'Move out of the dropdown',
          disabled: !canMoveTo(menu, position, { group: null, before: position.index + 1 }),
          onSelect: () => {
            change(moveTo(menu, position, { group: null, before: position.index + 1 }))
          },
        })
      }
      for (const group of groupsOf(menu)) {
        if (group.index === position.index && position.child !== undefined) continue
        const to = { group: group.index, before: groupLength(menu, group.index) }
        more.push({
          label: `Move into ${group.label === '' ? 'the untitled dropdown' : `“${group.label}”`}`,
          disabled: !canMoveTo(menu, position, to),
          onSelect: () => {
            change(moveTo(menu, position, to))
          },
        })
      }
    }
    more.push({
      label: item.kind === 'group' ? 'Remove the dropdown and its links' : 'Remove',
      onSelect: () => {
        change(removeAt(menu, position))
      },
    })
    return {
      name,
      canMoveUp: own > 0,
      canMoveDown: own < siblings - 1,
      onMove: (by) => {
        change(moveBy(menu, position, by))
      },
      more,
    }
  }

  function dragFor(position: MenuPosition, key: string, isGroup: boolean): RowDrag {
    const destination = (where: DropIndicator['where']): MenuDestination => {
      if (where === 'inside')
        return { group: position.index, before: groupLength(menu, position.index) }
      const own = position.child ?? position.index
      return {
        group: position.child === undefined ? null : position.index,
        before: where === 'before' ? own : own + 1,
      }
    }
    return {
      handle: {
        draggable: true,
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', key)
          setDragged(position)
        },
        onDragEnd: () => {
          setDragged(null)
          setIndicator(null)
        },
      },
      target: {
        onDragOver: (event) => {
          event.stopPropagation()
          if (dragged === null) return
          const where = dropZone(event, isGroup && itemAt(menu, dragged)?.kind !== 'group')
          const to = destination(where)
          if (!canMoveTo(menu, dragged, to)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          if (indicator?.key !== key || indicator.where !== where) setIndicator({ key, where, to })
        },
        onDragLeave: () => {
          if (indicator?.key === key) setIndicator(null)
        },
        onDrop: (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (dragged !== null && indicator?.key === key)
            change(moveTo(menu, dragged, indicator.to))
          setDragged(null)
          setIndicator(null)
        },
      },
      dragging: dragged !== null && samePosition(dragged, position),
      drop: indicator?.key === key ? indicator.where : undefined,
    }
  }

  function emptyGroupDrop(index: number) {
    const key = `empty-${index}`
    const to: MenuDestination = { group: index, before: 0 }
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation()
        if (dragged === null || !canMoveTo(menu, dragged, to)) return
        event.preventDefault()
        if (indicator?.key !== key) setIndicator({ key, where: 'inside', to })
      },
      onDragLeave: () => {
        if (indicator?.key === key) setIndicator(null)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault()
        event.stopPropagation()
        if (dragged !== null) change(moveTo(menu, dragged, to))
        setDragged(null)
        setIndicator(null)
      },
      drop: indicator?.key === key ? ('inside' as const) : undefined,
    }
  }

  function linkRow(link: PublicMenuLink, position: MenuPosition): ReactNode {
    const key = keys.keyOf(link)
    return (
      <LinkRow
        key={key}
        link={link}
        target={link.kind === 'url' ? undefined : targets.byId.get(link.id)}
        lookup={lookup}
        onChange={(next) => {
          change(replaceAt(menu, position, next), [link, next])
        }}
        actions={actionsFor(position, link)}
        drag={dragFor(position, key, false)}
        opening={openingFor(key)}
      />
    )
  }

  function composerFor(group: number | null): ReactNode {
    const open = composer !== null && composer.group === group
    const full =
      group === null ? menu.length >= MAX_MENU_ITEMS : groupLength(menu, group) >= MAX_GROUP_LINKS
    if (!open) {
      return group === null ? undefined : (
        <div>
          <Button
            size="sm"
            variant="ghost"
            disabled={full}
            iconStart={<PlusIcon />}
            onClick={() => {
              setComposer({ group })
            }}
          >
            Add a link to this dropdown
          </Button>
        </div>
      )
    }
    return (
      <div className={styles.composer()}>
        <MenuTargetPicker
          label={group === null ? 'Add a link' : 'Add a link to this dropdown'}
          focusOnMount
          onPick={(link) => {
            change(appendLink(menu, link, group))
            setComposer(null)
            // A new link opens, so its label is the next thing to set.
            setOpenKey(keys.keyOf(link))
          }}
          onDismiss={() => {
            setComposer(null)
          }}
        />
        <Button
          size="md"
          variant="ghost"
          onClick={() => {
            setComposer(null)
          }}
        >
          Cancel
        </Button>
      </div>
    )
  }

  /** A new dropdown opens, so its label is the next thing to type. */
  function addGroup(): void {
    const next = appendGroup(menu)
    const added = next.at(-1)
    change(next)
    if (added !== undefined && added !== menu.at(-1)) setOpenKey(keys.keyOf(added))
  }

  const atLimit = menu.length >= MAX_MENU_ITEMS

  return (
    <div className={styles.root()}>
      <MenuPreview menu={menu} targets={targets.byId} siteName={siteName} />

      <div className={styles.builder()}>
        {menu.length === 0 && composer === null ? (
          <div className={styles.empty()}>
            <p>
              No menu yet: the header shows the organisation’s name, the search and the colour
              switch. Add links to documents, collections or anywhere on the web, and group them
              into dropdowns.
            </p>
            <Toolbar
              onAddLink={() => {
                setComposer({ group: null })
              }}
              onAddGroup={addGroup}
              disabled={false}
            />
          </div>
        ) : (
          <>
            {menu.length === 0 ? undefined : (
              <ol aria-label="Menu items" className={styles.list()}>
                {menu.map((item, index) => {
                  const position = { index }
                  if (item.kind !== 'group') return linkRow(item, position)
                  const key = keys.keyOf(item)
                  return (
                    <GroupRow
                      key={key}
                      group={item}
                      onLabelChange={(label) => {
                        const next = { ...item, label }
                        change(replaceAt(menu, position, next), [item, next])
                      }}
                      actions={actionsFor(position, item)}
                      drag={dragFor(position, key, true)}
                      opening={openingFor(key)}
                      emptyDrop={emptyGroupDrop(index)}
                      composer={composerFor(index)}
                    >
                      {item.items.map((link, child) => linkRow(link, { index, child }))}
                    </GroupRow>
                  )
                })}
              </ol>
            )}
            {composerFor(null)}
            {composer?.group === null ? undefined : (
              <div className="flex flex-col gap-1.5">
                <Toolbar
                  onAddLink={() => {
                    setComposer({ group: null })
                  }}
                  onAddGroup={addGroup}
                  disabled={atLimit}
                />
                {atLimit ? (
                  <p className={styles.hint()}>
                    Eight items is the most the header holds. Group links into a dropdown to add
                    more.
                  </p>
                ) : undefined}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Toolbar({
  onAddLink,
  onAddGroup,
  disabled,
}: {
  readonly onAddLink: () => void
  readonly onAddGroup: () => void
  readonly disabled: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={onAddLink}
        iconStart={<PlusIcon />}
      >
        Add a link
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={onAddGroup}
        iconStart={<PlusIcon />}
      >
        Add a dropdown
      </Button>
    </div>
  )
}

function groupLength(menu: PublicMenu, index: number): number {
  const item = menu[index]
  return item?.kind === 'group' ? item.items.length : 0
}

function samePosition(left: MenuPosition, right: MenuPosition): boolean {
  return left.index === right.index && left.child === right.child
}

/**
 * Which part of a row the pointer is over. A link dragged over a dropdown has
 * three zones — the top and bottom quarters place it beside the dropdown, the
 * middle puts it inside — and everything else has two halves.
 */
function dropZone(event: DragEvent<HTMLElement>, canGoInside: boolean): DropIndicator['where'] {
  const box = event.currentTarget.getBoundingClientRect()
  const along = box.height === 0 ? 0.5 : (event.clientY - box.top) / box.height
  if (canGoInside) {
    if (along < 0.25) return 'before'
    if (along > 0.75) return 'after'
    return 'inside'
  }
  return along < 0.5 ? 'before' : 'after'
}

/**
 * Moving or editing a link inside a dropdown makes a new dropdown object, so
 * its key is carried from the dropdown it was made from: the one sharing a
 * link with it, or failing that — an emptied dropdown — the one that was in
 * its place.
 */
function carryGroupKeys(previous: PublicMenu, next: PublicMenu, keys: StableKeys): void {
  const previousGroups = previous.filter((item) => item.kind === 'group')
  for (const [index, item] of next.entries()) {
    if (item.kind !== 'group' || previous.includes(item)) continue
    const source =
      previousGroups.find((group) => group.items.some((link) => item.items.includes(link))) ??
      previous[index]
    if (source?.kind === 'group') keys.carry(source, item)
  }
}
