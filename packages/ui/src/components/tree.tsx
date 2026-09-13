import type { ThemeVariants } from '@quill/theme'

import { tv } from '../lib/class-names.ts'
import { PlainLink, type LinkComponent, type LinkTarget } from '../lib/link.tsx'
import { useThemeVariants } from '../theme/theme-variants.tsx'
import { Menu, type MenuItem } from './menu.tsx'

/**
 * The current document is the only item marked `aria-current="page"`, so that
 * attribute is what draws the accent bar: the state is one fact, announced and
 * painted from the same place, and nothing here decides a class from a prop.
 * `aria-pressed` plays the equivalent role in `selectable` mode (a chosen
 * destination rather than the page you are on), so it gets the same treatment.
 */
export const treeStyles = tv({
  slots: {
    root: 'flex flex-col gap-4 py-3.5',
    sectionHeader: 'group/section flex items-center justify-between gap-2 px-3 pb-1.5',
    groupLabel: 'meta',
    sectionControls: 'flex shrink-0 items-center gap-0.5',
    sectionAction: [
      'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted opacity-0',
      'hover:bg-surface hover:text-foreground group-hover/section:opacity-100 focus-visible:opacity-100',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
    ],
    branch: '',
    row: 'group/row flex items-center gap-0.5',
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
    link: [
      'flex min-h-7 min-w-0 grow cursor-pointer items-center gap-1.5 rounded-e-sm ps-3 pe-2 text-xs text-muted',
      'transition-[color,background-color] ease-standard',
      'hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
      'aria-[current=page]:bg-surface aria-[current=page]:font-medium',
      'aria-[current=page]:text-foreground aria-[current=page]:shadow-[inset_2px_0_0_var(--color-accent)]',
      'aria-pressed:bg-surface aria-pressed:font-medium aria-pressed:text-foreground',
      'aria-pressed:shadow-[inset_2px_0_0_var(--color-accent)]',
      'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    ],
    text: 'truncate',
    badge: 'meta shrink-0 text-muted',
    reason: 'meta shrink-0 text-muted',
  },
  variants: {
    /** Only a nested list carries the indent guide; the top level is flush. */
    nested: { true: { branch: 'tree-branch' } },
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
}

export interface TreeSection {
  readonly id: string
  /** The collection this branch belongs to, shown as a monospace overline. */
  readonly label: string
  readonly nodes: readonly TreeNode[]
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
   */
  readonly nodeActions?: ((node: TreeNode) => readonly TreeNodeAction[]) | undefined
  /**
   * Navigation mode only: how a row renders, normally the application's router
   * `Link` (client-side navigation, preload on intent). Defaults to
   * `PlainLink`, which is what the design showcase and any consumer with no
   * router get.
   */
  readonly linkComponent?: LinkComponent | undefined
  readonly className?: string | undefined
}

interface BranchProps {
  readonly nodes: readonly TreeNode[]
  readonly currentId: string | undefined
  readonly depth: number
  readonly selectable: boolean
  readonly selectedId: string | undefined
  readonly onSelect: ((id: string) => void) | undefined
  readonly nodeActions: ((node: TreeNode) => readonly TreeNodeAction[]) | undefined
  readonly linkComponent: LinkComponent
}

function Branch({
  nodes,
  currentId,
  depth,
  selectable,
  selectedId,
  onSelect,
  nodeActions,
  linkComponent: Link,
}: BranchProps) {
  const styles = treeStyles({ nested: depth > 0 })

  return (
    <ul className={styles.branch()}>
      {nodes.map((node) => {
        const actions = selectable ? [] : (nodeActions?.(node) ?? [])
        return (
          <li key={node.id}>
            <div className={styles.row()}>
              {selectable ? (
                <button
                  type="button"
                  className={styles.link()}
                  aria-pressed={node.id === selectedId}
                  disabled={node.disabled === true}
                  onClick={() => onSelect?.(node.id)}
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
                  aria-current={node.id === currentId ? 'page' : undefined}
                >
                  <span className={styles.text()}>{node.label}</span>
                </Link>
              )}
              <Menu label={node.label} items={actions} triggerClassName={styles.rowMenu()} />
            </div>
            {node.children === undefined ? undefined : (
              <Branch
                nodes={node.children}
                currentId={currentId}
                depth={depth + 1}
                selectable={selectable}
                selectedId={selectedId}
                onSelect={onSelect}
                nodeActions={nodeActions}
                linkComponent={Link}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
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
 * `selectable` swaps the links for plain buttons — a destination picker
 * (`MoveDocumentDialog`) rather than a navigation surface — and reuses every
 * other rule (nesting, grouping, keyboard order) unchanged.
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
  className,
}: TreeProps) {
  const variants = useThemeVariants()
  const navigation = variant ?? variants.navigation
  const styles = treeStyles()

  return (
    <nav aria-label={label} data-navigation={navigation} className={styles.root({ className })}>
      {sections.map((section) => (
        <div key={section.id}>
          <div className={styles.sectionHeader()}>
            <p className={styles.groupLabel()}>{section.label}</p>
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
          <Branch
            nodes={section.nodes}
            currentId={currentId}
            depth={0}
            selectable={selectable}
            selectedId={selectedId}
            onSelect={onSelect}
            nodeActions={nodeActions}
            linkComponent={linkComponent}
          />
        </div>
      ))}
    </nav>
  )
}
