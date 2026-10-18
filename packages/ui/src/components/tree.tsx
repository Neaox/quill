import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { flushSync } from 'react-dom'
import type { ThemeVariants } from '@quill/theme'

import { tv } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent, type LinkTarget } from '../lib/link.tsx'
import { useThemeVariants } from '../theme/theme-variants.tsx'
import { ChevronRightIcon } from './icons.tsx'
import { Menu, type MenuItem } from './menu.tsx'
import {
  ANCESTOR_CONTEXT,
  findPath,
  nodeKey,
  readChoices,
  sectionKey,
  windowFor,
  writeChoices,
  type TreePath,
  type TreeWindow,
} from './tree-model.ts'

/**
 * The current document is the only item marked `aria-current="page"`, so that
 * attribute is what draws the accent bar: the state is one fact, announced and
 * painted from the same place, and nothing here decides a class from a prop.
 * `aria-pressed` plays the equivalent role in `selectable` mode (a chosen
 * destination rather than the page you are on), so it gets the same treatment.
 * A disclosure's chevron turns on its own `aria-expanded`, for the same reason.
 */
export const treeStyles = tv({
  slots: {
    root: 'flex flex-col gap-5 py-3',
    /*
     * In the sidebar a collection's heading stays at the top of the scrolling
     * region while its documents pass beneath it, on the page's own ground so
     * they do not show through: a reader deep in a long list still knows which
     * collection it is in, and the next one's heading pushes it off as it
     * arrives, because each is pinned only within its own collection.
     */
    sectionHeader: [
      'group/section flex min-h-7 items-center justify-between gap-2 pe-1 pb-0.5',
      'data-pinned:sticky data-pinned:top-0 data-pinned:z-10 data-pinned:bg-background',
    ],
    /*
     * The section's label is its disclosure: one press target the width of
     * the label, announced as "Guides, 12 documents, expanded". The chevron
     * after it is quiet until the header is hovered or focused, and stays
     * drawn while the section is closed, so a closed section says so.
     */
    sectionToggle: [
      'group/toggle flex min-h-7 min-w-0 cursor-pointer items-center gap-1 rounded-md ps-2 pe-1 text-start',
      'hover:bg-surface',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    sectionChevron: [
      'size-3 shrink-0 text-muted opacity-0 transition-[transform,opacity] duration-150 ease-standard',
      'motion-reduce:transition-none',
      'group-hover/section:opacity-100 group-focus-visible/toggle:opacity-100',
      'group-aria-[expanded=false]/toggle:opacity-100 group-aria-expanded/toggle:rotate-90',
    ],
    groupLabel: 'section-label truncate',
    count: 'section-count ms-1.5',
    sectionControls: 'flex shrink-0 items-center gap-0.5',
    sectionAction: [
      'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted opacity-0',
      'hover:bg-surface hover:text-foreground group-hover/section:opacity-100 focus-visible:opacity-100',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    branch: 'flex flex-col gap-px',
    row: 'group/row flex items-center gap-0.5',
    /*
     * A node with children carries a real button beside its link: the link
     * still navigates, and the chevron opens and closes the branch without
     * leaving the page. A leaf gets an empty slot the same width, so labels
     * in one branch line up whether or not they have children.
     */
    disclosure: [
      'group/disclosure flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm',
      'text-muted hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    chevron: [
      'size-3 transition-transform duration-150 ease-standard motion-reduce:transition-none',
      'group-aria-expanded/disclosure:rotate-90',
    ],
    leaf: 'size-5 shrink-0',
    /*
     * A row's actions are revealed by hovering it, focusing the control, or
     * opening the menu — the same treatment a collection's own "+" gets, and
     * for the same reason: a hundred permanently drawn "⋯" is noise down the
     * side of a document. It stays in the DOM throughout, so the keyboard
     * reaches it whether or not a pointer ever has.
     */
    rowMenu: [
      'opacity-0 transition-opacity ease-standard',
      'group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
    ],
    /** The same treatment for a collection's own menu, keyed on its header instead. */
    sectionMenu: [
      'opacity-0 transition-opacity ease-standard',
      'group-hover/section:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
    ],
    /*
     * Documents are text a reader scans, so they are set in the middle ink at
     * the chrome's reading size; the one being read sits on the soft accent
     * selection, in full ink and one weight up. Selection, weight and
     * `aria-current` together, so it never rests on the tint alone.
     */
    link: [
      'flex min-h-7 min-w-0 grow cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1',
      'text-xs leading-snug text-foreground-soft',
      'transition-[color,background-color] ease-standard',
      'hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
      'aria-[current=page]:bg-accent-subtle aria-[current=page]:font-semibold',
      'aria-[current=page]:text-foreground',
      'aria-pressed:bg-accent-subtle aria-pressed:font-semibold aria-pressed:text-foreground',
      'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    ],
    text: 'truncate',
    badge: 'shrink-0 text-2xs font-normal text-muted',
    reason: 'shrink-0 text-2xs font-normal text-muted',
    /*
     * "Show more" reads as a row of the list, set in the quietest ink and
     * indented to the labels, so it never competes with a document's name.
     */
    more: [
      'ms-5 flex min-h-7 cursor-pointer items-center gap-1.5 self-start rounded-md px-1.5 py-1',
      'text-2xs font-medium text-muted hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    moreCount: 'font-normal tabular-nums',
    loading: 'ms-5 px-1.5 py-1 text-2xs text-muted',
    failed: 'ms-5 flex flex-wrap items-center gap-x-2 px-1.5 py-1 text-2xs text-muted',
    retry: [
      'cursor-pointer rounded-sm font-medium text-foreground-soft underline underline-offset-2',
      'hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
    ],
  },
  variants: {
    /** Only a nested list carries the indent guide; the top level is flush. */
    nested: { true: { branch: 'tree-branch ms-2.5 mt-px ps-0.5 max-md:ms-2 max-md:ps-0' } },
    /*
     * Past a few levels the indent stops growing, so a page twelve levels
     * down in a sidebar a few hundred pixels wide still shows its name, and
     * the deeper lists draw no guide of their own: the guide of the deepest
     * indented level runs on down beside them, one line rather than a band.
     * The nesting itself — what a screen reader announces — is unchanged.
     */
    deep: { true: { branch: 'ms-0 border-s-0 ps-0' } },
    /*
     * On a phone the step is smaller and the indent stops after three
     * levels, the same way: a sheet the width of the screen still has a
     * long title's room at the twelfth.
     */
    deepOnPhone: { true: { branch: 'max-md:ms-0 max-md:border-s-0 max-md:ps-0' } },
  },
})

/** An entry in a row's or a section's actions menu. The design system's `MenuItem`. */
export type TreeNodeAction = MenuItem

export interface TreeNode {
  readonly id: string
  readonly label: string
  /**
   * Where the document is, as a route and its parameters (never a built
   * `href`). Omitted only in `selectable` mode, whose nodes are buttons.
   */
  readonly link?: LinkTarget | undefined
  readonly children?: readonly TreeNode[] | undefined
  /** `selectable` mode only: cannot be chosen (moving a document into its own subtree, for example). */
  readonly disabled?: boolean | undefined
  /** `selectable` mode only: shown beside a disabled node, so the reason is reachable without a tooltip (`docs/design/feedback.md`). */
  readonly disabledReason?: string | undefined
  /** `selectable` mode only: marks the destination the caller already occupies. */
  readonly current?: boolean | undefined
  /**
   * How many children the node has in all, when `children` holds only some of
   * them or none yet: the rest are asked for through `onLoad` as the node is
   * opened or paged. Omitted, `children` is all of them.
   */
  readonly childCount?: number | undefined
  /** Where `children` starts among all of the node's children. */
  readonly childrenOffset?: number | undefined
}

export interface TreeSection {
  readonly id: string
  /** The collection this branch belongs to, shown as the section's label. */
  readonly label: string
  /**
   * How many documents the section holds, nesting included, shown beside the
   * label in the quietest ink. Omitted, no count is drawn.
   */
  readonly count?: number | undefined
  readonly nodes: readonly TreeNode[]
  /** How many top-level documents the section has in all, when `nodes` is a slice of them. */
  readonly nodeCount?: number | undefined
  /** Where `nodes` starts among them. */
  readonly nodesOffset?: number | undefined
  /**
   * A single action beside the section label, revealed on hover or focus
   * ("New document in Guides") — always in the DOM, so it stays reachable by
   * keyboard when the pointer has not revealed it. Navigation mode only.
   */
  readonly action?: TreeNodeAction | undefined
  /**
   * The section's own actions ("Rename…", "Delete…"), behind a "more actions"
   * disclosure beside the label — the same one a node row gets, because a
   * collection is a thing with a menu exactly as a document is. A section with
   * none gets no disclosure. Navigation mode only.
   */
  readonly actions?: readonly TreeNodeAction[] | undefined
}

/** How many children a branch draws before "Show more". */
export const TREE_PAGE_SIZE = 50

/** How long the open row is kept in view while late styles and fonts settle. */
const REVEAL_WATCH_MS = 5000

/** The deepest level that still indents further (`deep` in `treeStyles`). */
const MAX_INDENTED_DEPTH = 5

/** The same, below the medium breakpoint. */
const MAX_INDENTED_DEPTH_ON_PHONE = 3

export interface TreeProps {
  /** Names the navigation landmark. Required: a nameless `nav` is noise. */
  readonly label: string
  readonly sections: readonly TreeSection[]
  /** The document being read. Marked `aria-current="page"`, nothing else. Navigation mode only. */
  readonly currentId?: string | undefined
  /**
   * `tree` is the indent-guided list below.
   *
   * `tabs` is Atelier's coloured collection tabs, and it is **not built yet**:
   * it renders the tree and marks itself `data-navigation="tabs"` so the page
   * is correct and the gap is visible. See `TODO(ADR-028)` in `tree.test.tsx`.
   */
  readonly variant?: ThemeVariants['navigation'] | undefined
  /**
   * Turns every node into a destination button instead of a navigation link —
   * the mode `MoveDocumentDialog`'s tree picker uses. `currentId` and
   * `nodeActions` are ignored in this mode; a node's own `current`/`disabled`
   * fields carry the equivalent facts instead.
   */
  readonly selectable?: boolean | undefined
  /** `selectable` mode only: the node currently chosen, marked `aria-pressed`. */
  readonly selectedId?: string | undefined
  /** `selectable` mode only: called with a node's id when it is chosen. */
  readonly onSelect?: ((id: string) => void) | undefined
  /**
   * Per-node actions, reachable from a "more actions" disclosure beside the
   * link (navigation mode only). A node with no actions gets no disclosure.
   * Asked only for the rows that are drawn.
   */
  readonly nodeActions?: ((node: TreeNode) => readonly TreeNodeAction[]) | undefined
  /**
   * Navigation mode only: how a row renders, normally the application's router
   * `Link` (client-side navigation, preload on intent). Defaults to
   * `PlainLink`, which is what the design showcase and any consumer with no
   * router get.
   */
  readonly linkComponent?: LinkComponent | undefined
  /** How many children a branch draws before offering "Show more". */
  readonly pageSize?: number | undefined
  /**
   * Remembers which branches were opened or closed by hand for the rest of the
   * browser tab's session, under this key (one per workspace, say). Omitted,
   * the choices last as long as the tree is mounted — which for the sidebar is
   * every navigation inside the workspace anyway.
   */
  readonly persistenceKey?: string | undefined
  /**
   * Asked for a slice of a list the tree has been given only part of — a node
   * opened whose children were not sent, or a page shown that is not loaded.
   * The caller fetches it and renders again with it; the tree shows the list
   * as loading meanwhile. Asked again only when the slice it wants changes,
   * so a caller should drop a request it already has in flight.
   */
  readonly onLoad?: ((request: TreeLoadRequest) => void) | undefined
  /**
   * Whether the last request for a list failed. Such a list says so, with a
   * "Try again" that asks `onLoad` once more, rather than "Loading…" for ever.
   */
  readonly loadFailed?: ((owner: TreeLoadRequest['owner']) => boolean) | undefined
  readonly className?: string | undefined
}

/** A slice of one list in the tree: a section's top level, or a node's children. */
export interface TreeLoadRequest {
  readonly owner: { readonly kind: 'section' | 'node'; readonly id: string }
  readonly offset: number
  readonly limit: number
}

/** Everything a branch needs from the tree, passed down once rather than prop by prop. */
interface TreeScope {
  readonly currentId: string | undefined
  readonly selectable: boolean
  readonly selectedId: string | undefined
  readonly onSelect: ((id: string) => void) | undefined
  readonly nodeActions: ((node: TreeNode) => readonly TreeNodeAction[]) | undefined
  readonly link: LinkComponent
  readonly pageSize: number
  readonly baseId: string
  readonly isOpen: (key: string) => boolean
  readonly setOpen: (key: string, open: boolean) => void
  readonly windowOf: (key: string, length: number) => TreeWindow
  readonly showMore: (key: string, window: TreeWindow, focusId: string | undefined) => void
  readonly onLoad: ((request: TreeLoadRequest) => void) | undefined
  readonly loadFailed: ((owner: TreeLoadRequest['owner']) => boolean) | undefined
}

/** The id the DOM gives a branch's list, for its disclosure's `aria-controls`. */
function branchDomId(baseId: string, key: string): string {
  return `${baseId}-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

/** ArrowRight opens and ArrowLeft closes, from the disclosure itself — the file-tree habit. */
function arrowsToggle(open: boolean, setOpen: (open: boolean) => void) {
  return (event: KeyboardEvent<HTMLButtonElement>) => {
    const forward = event.key === 'ArrowRight' && !open
    const back = event.key === 'ArrowLeft' && open
    if (!forward && !back) return
    event.preventDefault()
    setOpen(forward)
  }
}

interface BranchProps {
  readonly branchKey: string
  /** What the branch belongs to, for the "Show more" control's name. */
  readonly owner: string
  readonly nodes: readonly TreeNode[]
  /** How many entries the list has in all; `nodes.length` when they are all here. */
  readonly total: number
  /** Where `nodes` starts among them. */
  readonly loadedFrom: number
  /** Whose list it is, for `onLoad`: a section's or a node's. */
  readonly ownerKind: TreeLoadRequest['owner']['kind']
  readonly ownerId: string
  readonly depth: number
  readonly scope: TreeScope
}

/** The part of `window` outside the loaded slice `[from, to)`, nearest first. */
function missingFrom(window: TreeWindow, from: number, to: number): TreeWindow | undefined {
  if (window.end <= window.start) return undefined
  if (window.start < from) return { start: window.start, end: Math.min(window.end, from) }
  if (window.end > to) return { start: Math.max(window.start, to), end: window.end }
  return undefined
}

/*
 * Branches and rows are memoised: the sidebar re-renders whenever the page
 * around it does (a query settling, the document's envelope arriving), and a
 * row whose node and scope have not changed has nothing new to draw.
 */
const Branch = memo(function Branch({
  branchKey,
  owner,
  nodes,
  total,
  loadedFrom,
  ownerKind,
  ownerId,
  depth,
  scope,
}: BranchProps) {
  const styles = treeStyles({
    nested: depth > 0,
    deep: depth > MAX_INDENTED_DEPTH,
    deepOnPhone: depth > MAX_INDENTED_DEPTH_ON_PHONE,
  })
  const window = scope.windowOf(branchKey, total)
  const earlier = Math.min(scope.pageSize, window.start)
  const later = Math.min(scope.pageSize, total - window.end)
  const loadedTo = loadedFrom + nodes.length
  const missing = missingFrom(window, loadedFrom, loadedTo)
  const shown = nodes.slice(
    Math.max(0, window.start - loadedFrom),
    Math.max(0, Math.min(window.end, loadedTo) - loadedFrom),
  )

  const { onLoad } = scope
  const failed =
    missing !== undefined && scope.loadFailed?.({ kind: ownerKind, id: ownerId }) === true
  // A window that does not draw the whole list says where each row is in it,
  // which the nested list alone would count from the first drawn row.
  const firstShown = Math.max(window.start, loadedFrom)
  const windowed = shown.length !== total
  const missingStart = missing?.start
  const missingEnd = missing?.end
  // Asks the caller for what the window wants and was not given: the server
  // is the external system this synchronises with, and the caller drops a
  // request it already has in flight.
  useEffect(() => {
    if (onLoad === undefined || missingStart === undefined || missingEnd === undefined) return
    onLoad({
      owner: { kind: ownerKind, id: ownerId },
      offset: missingStart,
      limit: missingEnd - missingStart,
    })
  }, [onLoad, ownerKind, ownerId, missingStart, missingEnd])

  return (
    <>
      {earlier === 0 ? undefined : (
        <button
          type="button"
          className={styles.more()}
          onClick={() => {
            const start = window.start - earlier
            scope.showMore(branchKey, { start, end: window.end }, nodes[start - loadedFrom]?.id)
          }}
        >
          {`Show ${earlier.toLocaleString()} earlier`}
          {/* The count says something only when there is more than one press of it. */}
          {window.start > earlier ? (
            <>
              <span className="sr-only">, </span>
              <span className={styles.moreCount()}>{`${window.start.toLocaleString()} above`}</span>
            </>
          ) : undefined}
          <span className="sr-only">{`, in ${owner}`}</span>
        </button>
      )}
      <ul id={branchDomId(scope.baseId, branchKey)} className={styles.branch()}>
        {shown.map((node, index) => (
          <Row
            key={node.id}
            node={node}
            depth={depth}
            scope={scope}
            place={windowed ? { position: firstShown + index + 1, size: total } : undefined}
          />
        ))}
      </ul>
      {missing === undefined || onLoad === undefined ? undefined : failed ? (
        <div className={styles.failed()}>
          <p role="status">{`Couldn’t load the documents in ${owner}`}</p>
          <button
            type="button"
            className={styles.retry()}
            onClick={() => {
              onLoad({
                owner: { kind: ownerKind, id: ownerId },
                offset: missing.start,
                limit: missing.end - missing.start,
              })
            }}
          >
            Try again<span className="sr-only">{`, in ${owner}`}</span>
          </button>
        </div>
      ) : (
        <p className={styles.loading()} role="status" aria-busy="true">
          <span className="sr-only">{`Loading documents in ${owner}`}</span>
          <span aria-hidden="true">Loading…</span>
        </p>
      )}
      {later === 0 ? undefined : (
        <button
          type="button"
          className={styles.more()}
          onClick={() => {
            scope.showMore(branchKey, { start: window.start, end: window.end + later }, undefined)
          }}
        >
          {`Show ${later.toLocaleString()} more`}
          {total - window.end > later ? (
            <>
              <span className="sr-only">, </span>
              <span className={styles.moreCount()}>
                {`${(total - window.end).toLocaleString()} not shown`}
              </span>
            </>
          ) : undefined}
          <span className="sr-only">{`, in ${owner}`}</span>
        </button>
      )}
    </>
  )
})

const Row = memo(function Row({
  node,
  depth,
  scope,
  place,
}: {
  readonly node: TreeNode
  readonly depth: number
  readonly scope: TreeScope
  /** Where the row is among all its siblings, for a branch drawn a window at a time. */
  readonly place?: { readonly position: number; readonly size: number } | undefined
}) {
  const styles = treeStyles()
  const { link: Link } = scope
  const actions = scope.selectable ? [] : (scope.nodeActions?.(node) ?? [])
  const children = node.children ?? []
  const childCount = node.childCount ?? children.length
  const key = nodeKey(node.id)
  const open = childCount > 0 && scope.isOpen(key)

  return (
    <li
      data-node-id={node.id}
      {...(place === undefined
        ? {}
        : { 'aria-posinset': place.position, 'aria-setsize': place.size })}
    >
      <div className={styles.row()}>
        {childCount === 0 ? (
          <span className={styles.leaf()} aria-hidden="true" />
        ) : (
          <button
            type="button"
            className={styles.disclosure()}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
            {...(open ? { 'aria-controls': branchDomId(scope.baseId, key) } : {})}
            onClick={() => {
              scope.setOpen(key, !open)
            }}
            onKeyDown={arrowsToggle(open, (next) => {
              scope.setOpen(key, next)
            })}
          >
            <ChevronRightIcon className={styles.chevron()} />
          </button>
        )}
        {scope.selectable ? (
          <button
            type="button"
            className={styles.link()}
            aria-pressed={node.id === scope.selectedId}
            disabled={node.disabled === true}
            onClick={() => scope.onSelect?.(node.id)}
          >
            <span className={styles.text()}>{node.label}</span>
            {node.current === true ? (
              <span className={styles.badge()}>current location</span>
            ) : undefined}
            {node.disabled === true && node.disabledReason !== undefined ? (
              <span className={styles.reason()}>{node.disabledReason}</span>
            ) : undefined}
          </button>
        ) : (
          <Link
            {...(node.link ?? { to: '' })}
            className={styles.link()}
            aria-current={node.id === scope.currentId ? 'page' : undefined}
          >
            <span className={styles.text()}>{node.label}</span>
          </Link>
        )}
        <Menu label={node.label} items={actions} triggerClassName={styles.rowMenu()} />
      </div>
      {open ? (
        <Branch
          branchKey={key}
          owner={node.label}
          nodes={children}
          total={childCount}
          loadedFrom={node.childrenOffset ?? 0}
          ownerKind="node"
          ownerId={node.id}
          depth={depth + 1}
          scope={scope}
        />
      ) : undefined}
    </li>
  )
})

/** The nearest ancestor that scrolls on its own, if the element is in one. */
function scrollContainerOf(element: HTMLElement): HTMLElement | undefined {
  for (let container = element.parentElement; container !== null;) {
    const overflow = getComputedStyle(container).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return container
    container = container.parentElement
  }
  return undefined
}

/** Whether an element is inside the visible part of its scroll container and of the window. */
function isInView(element: HTMLElement, container: HTMLElement): boolean {
  const box = element.getBoundingClientRect()
  const frame = container.getBoundingClientRect()
  return (
    box.top >= Math.max(frame.top, 0) &&
    box.bottom <= Math.min(frame.bottom, globalThis.innerHeight)
  )
}

/** The first node marked `current` under `nodes`, depth first. */
function findCurrentIn(nodes: readonly TreeNode[]): string | undefined {
  for (const node of nodes) {
    if (node.current === true) return node.id
    const inside = findCurrentIn(node.children ?? [])
    if (inside !== undefined) return inside
  }
  return undefined
}

/** A picker's current destination, the node marked `current`. */
function findCurrentId(sections: readonly TreeSection[]): string | undefined {
  for (const section of sections) {
    const found = findCurrentIn(section.nodes)
    if (found !== undefined) return found
  }
  return undefined
}

/** The paths to keep visible: the open document, or in a picker the chosen and the current destinations. */
function revealedPaths(
  sections: readonly TreeSection[],
  selectable: boolean,
  currentId: string | undefined,
  selectedId: string | undefined,
): readonly TreePath[] {
  const target = selectable ? selectedId : currentId
  const paths = [
    target === undefined ? undefined : findPath(sections, (node) => node.id === target),
    selectable ? findPath(sections, (node) => node.current === true) : undefined,
  ]
  return paths.filter((path) => path !== undefined)
}

/**
 * The document tree.
 *
 * A navigation landmark containing one nested list per collection, because
 * nesting is the meaning: a screen reader announces the depth and the item
 * count without any ARIA of ours. Every item is a link, so it opens in a new
 * tab, it can be copied, and it works before any JavaScript runs; the accent
 * bar beside the current document is the same fact drawn twice rather than the
 * only way to know.
 *
 * It draws only what is visible. A node with children is closed until opened
 * by its chevron (a real button, `aria-expanded`, ArrowRight and ArrowLeft
 * from it) — except the ancestors of the open document, which open so it is
 * on screen and scrolled to — and a closed node's children are not rendered
 * at all. A branch of thousands of siblings draws one page and a "Show more"
 * button, the way Confluence's page tree does, rather than a virtual window:
 * every drawn row stays a real list item in a real nested list, so a screen
 * reader's list navigation, the browser's find-in-page for what is drawn, and
 * the tab order all work unchanged, and the long tail is one button press —
 * or the collection's search — away. Sections fold the same way from their
 * labels. What was opened or closed by hand survives navigation.
 *
 * `selectable` swaps the links for plain buttons — a destination picker
 * (`MoveDocumentDialog`) rather than a navigation surface — and reuses every
 * other rule (nesting, folding, paging, keyboard order) unchanged.
 */
export function Tree({
  label,
  sections,
  currentId,
  variant,
  selectable = false,
  selectedId,
  onSelect,
  nodeActions,
  linkComponent = PlainLink,
  pageSize = TREE_PAGE_SIZE,
  persistenceKey,
  onLoad,
  loadFailed,
  className,
}: TreeProps) {
  const variants = useThemeVariants()
  const navigation = variant ?? variants.navigation
  const styles = treeStyles()
  const baseId = useId()
  const nav = useRef<HTMLElement>(null)

  const paths = useMemo(
    () => revealedPaths(sections, selectable, currentId, selectedId),
    [sections, selectable, currentId, selectedId],
  )
  // The way to the open document, and the document itself: its own children
  // are what a reader most likely wants next, as Confluence's tree has it.
  const target = selectable ? selectedId : currentId
  const revealed = useMemo(
    () =>
      new Set([
        ...paths.flatMap((path) => path.open),
        ...(target === undefined ? [] : [nodeKey(target)]),
      ]),
    [paths, target],
  )
  // The first path wins where two pass through one branch: the open document
  // before the picker's current location.
  const positions = useMemo(
    () => new Map(paths.toReversed().flatMap((path) => [...path.positions])),
    [paths],
  )

  // The levels above the open document's own: each shows the way down and a
  // few rows around it, rather than a page of siblings at every level.
  const ancestorLevels = useMemo(() => {
    const deepest = new Set(paths.map((path) => path.deepest))
    return new Set([...positions.keys()].filter((key) => !deepest.has(key)))
  }, [paths, positions])

  // Opened and closed by hand; everything else follows the defaults below.
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(() =>
    persistenceKey === undefined ? new Map() : readChoices(persistenceKey),
  )
  // Widened by "Show more"; otherwise the page that holds the open document.
  const [windows, setWindows] = useState<ReadonlyMap<string, TreeWindow>>(() => new Map())

  // A newly opened document is shown even where it was folded away by hand:
  // its section and ancestors reopen, and a branch paged past it pages back.
  // Adjusted while rendering, the documented alternative to an effect.
  const revealKey = target ?? ''
  const [revealedFor, setRevealedFor] = useState<string | undefined>(undefined)
  if (revealedFor !== revealKey) {
    setRevealedFor(revealKey)
    if ([...revealed].some((key) => choices.get(key) === false)) {
      setChoices(new Map([...choices].filter(([key, open]) => open || !revealed.has(key))))
    }
    const stale = [...windows].filter(([key, window]) => {
      const position = positions.get(key)
      return position !== undefined && (position < window.start || position >= window.end)
    })
    if (stale.length > 0) {
      const keep = new Set(stale.map(([key]) => key))
      setWindows(new Map([...windows].filter(([key]) => !keep.has(key))))
    }
  }

  // The open document's row — in a picker, the chosen destination or else the
  // current one — is scrolled into its container's view when it changes: the
  // DOM's scroll position is the external system.
  const scrollTarget = selectable ? (selectedId ?? findCurrentId(sections)) : currentId
  // Synchronises the container's scroll position (the DOM) with the open row.
  // Late layout — the organisation's theme stylesheet or the web fonts
  // arriving — changes every row's height, which in a big tree carries the row
  // a long way out of view; so the tree is watched for a few seconds and the
  // row brought back, until the person scrolls or presses anything themselves.
  useEffect(() => {
    const container = nav.current
    if (scrollTarget === undefined || container === null) return undefined
    const reveal = () => {
      const row = [...container.querySelectorAll<HTMLElement>('[data-node-id]')].find(
        (element) => element.dataset['nodeId'] === scrollTarget,
      )
      // Nothing to scroll with (a test environment): the style walk below is not worth doing.
      if (row === undefined || typeof row.scrollTo !== 'function') return
      // Only the tree's own region is scrolled (the sidebar, the phone's sheet, a picker's
      // list), never the page around it: `scrollIntoView` would scroll every ancestor, so a
      // tree in a page — a specimen on the design page — would carry the whole page to its open
      // row, and again whenever the layout settles. A tree in no region of its own is left be.
      const region = scrollContainerOf(row)
      if (region === undefined) return
      // Left alone when it is already in view — a row just clicked does not
      // jump — and brought to the middle when it is not, with context around it.
      if (isInView(row, region)) return
      const box = row.getBoundingClientRect()
      const frame = region.getBoundingClientRect()
      region.scrollTo({
        top: region.scrollTop + box.top - frame.top - (region.clientHeight - box.height) / 2,
      })
    }
    // In the next frame, when the browser lays the page out anyway, rather
    // than forcing a layout of its own straight after the commit.
    const frame = requestAnimationFrame(reveal)
    if (typeof ResizeObserver !== 'function') {
      return () => {
        cancelAnimationFrame(frame)
      }
    }
    const watch = new ResizeObserver(reveal)
    watch.observe(container)
    const stop = () => {
      watch.disconnect()
    }
    const settled = setTimeout(stop, REVEAL_WATCH_MS)
    const handover = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const type of handover) container.addEventListener(type, stop, { once: true })
    return () => {
      cancelAnimationFrame(frame)
      stop()
      clearTimeout(settled)
      for (const type of handover) container.removeEventListener(type, stop)
    }
  }, [scrollTarget])

  // "Show earlier" removes itself once there is nothing earlier, and focus
  // would fall to the page; it goes to the first row it revealed instead,
  // drawn synchronously inside the press so there is a row to give it to.
  const showMore = useCallback(
    (key: string, window: TreeWindow, focusId: string | undefined) => {
      flushSync(() => {
        setWindows((current) => new Map(current).set(key, window))
      })
      if (focusId === undefined) return
      const list = globalThis.document.getElementById(branchDomId(baseId, key))
      /* v8 ignore next -- the branch was drawn synchronously just above; `?? []` narrows the lookup. */
      const row = [...(list?.children ?? [])].find(
        (element) => element instanceof HTMLElement && element.dataset['nodeId'] === focusId,
      )
      row?.querySelector<HTMLElement>('a, button:not([aria-expanded])')?.focus()
    },
    [baseId],
  )

  const scope = useMemo<TreeScope>(() => {
    const setOpen = (key: string, open: boolean) => {
      const next = new Map(choices).set(key, open)
      setChoices(next)
      if (persistenceKey !== undefined) writeChoices(persistenceKey, next)
    }
    return {
      currentId,
      selectable,
      selectedId,
      onSelect,
      nodeActions,
      link: linkComponent,
      pageSize,
      baseId,
      isOpen: (key) => choices.get(key) ?? revealed.has(key),
      setOpen,
      windowOf: (key, length) =>
        windowFor(
          length,
          pageSize,
          windows.get(key),
          positions.get(key),
          ancestorLevels.has(key) ? ANCESTOR_CONTEXT : undefined,
        ),
      showMore,
      onLoad,
      loadFailed,
    }
  }, [
    currentId,
    selectable,
    selectedId,
    onSelect,
    nodeActions,
    linkComponent,
    pageSize,
    baseId,
    choices,
    revealed,
    windows,
    positions,
    ancestorLevels,
    showMore,
    onLoad,
    loadFailed,
    persistenceKey,
  ])
  const { setOpen } = scope

  return (
    <nav
      ref={nav}
      aria-label={label}
      data-navigation={navigation}
      className={styles.root({ className })}
    >
      {sections.map((section) => {
        const key = sectionKey(section.id)
        const open = choices.get(key) ?? true
        const listId = branchDomId(baseId, key)
        return (
          <div key={section.id}>
            <div
              data-section-header=""
              {...(selectable ? {} : { 'data-pinned': '' })}
              className={styles.sectionHeader()}
            >
              <button
                type="button"
                className={styles.sectionToggle()}
                aria-expanded={open}
                {...(open ? { 'aria-controls': listId } : {})}
                onClick={() => {
                  setOpen(key, !open)
                }}
                onKeyDown={arrowsToggle(open, (next) => {
                  setOpen(key, next)
                })}
              >
                <span className={styles.groupLabel()}>
                  <span>{section.label}</span>
                  {section.count === undefined ? undefined : (
                    <span className={styles.count()}>
                      {section.count.toLocaleString()}
                      <span className="sr-only">
                        {section.count === 1 ? ' document' : ' documents'}
                      </span>
                    </span>
                  )}
                </span>
                <ChevronRightIcon className={styles.sectionChevron()} />
              </button>
              <div className={styles.sectionControls()}>
                {section.action === undefined ? undefined : (
                  <button
                    type="button"
                    className={styles.sectionAction()}
                    onClick={section.action.onSelect}
                    aria-label={section.action.label}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                )}
                {selectable || section.actions === undefined ? undefined : (
                  <Menu
                    label={section.label}
                    items={section.actions}
                    triggerClassName={styles.sectionMenu()}
                  />
                )}
              </div>
            </div>
            {open ? (
              <Branch
                branchKey={key}
                owner={section.label}
                nodes={section.nodes}
                total={section.nodeCount ?? section.nodes.length}
                loadedFrom={section.nodesOffset ?? 0}
                ownerKind="section"
                ownerId={section.id}
                depth={0}
                scope={scope}
              />
            ) : undefined}
          </div>
        )
      })}
    </nav>
  )
}
