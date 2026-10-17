import {
  useCallback,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'

import {
  Button,
  CollectionIcon,
  DocumentIcon,
  DropdownIcon,
  ExternalIcon,
  Input,
  LinkIcon,
  Menu,
  tv,
  type MenuItem,
} from '@quill/ui'

import type { PublicMenuGroup, PublicMenuLink, PublicMenuTarget } from '../../../lib/api/index.ts'
import { ToggleField } from '../toggle-field.tsx'
import {
  hidesReferrer,
  isExternalAddress,
  itemIssues,
  MAX_LABEL_LENGTH,
  MAX_URL_LENGTH,
  withAddress,
  withReferrerHidden,
} from './menu-model.ts'
import { MenuTargetPicker } from './menu-target-picker.tsx'

/**
 * The rows of the menu builder: a link, and a dropdown holding links.
 *
 * A row is one compact line (`MenuRow`) — the drag handle, an icon for what
 * kind of item it is, its label, what it points at in a quieter ink, and a
 * word only when something is wrong — so a menu reads as a list rather than a
 * wall of fields, the way Linear and Vercel lay out their navigation
 * settings. The line is a button: pressing it, or Enter on it, opens the row's
 * fields underneath, one row at a time, and Escape closes them again. Alt with
 * an arrow moves the focused row; the "⋯" menu holds the same moves and the
 * rest. The drag handle is for a pointer only and hidden from assistive
 * technology (AGENTS.md rule 14).
 */

export const menuRowStyles = tv({
  slots: {
    item: [
      'rounded-lg border border-transparent transition-[background-color,box-shadow,opacity]',
      'ease-standard data-[dragging=true]:opacity-50',
      'data-[open=true]:border-border data-[open=true]:bg-surface-raised',
      'data-[drop=before]:shadow-[0_-2px_0_0_var(--color-accent)]',
      'data-[drop=after]:shadow-[0_2px_0_0_var(--color-accent)]',
      'data-[drop=inside]:border-accent',
    ],
    line: 'group/line flex h-11 min-w-0 items-center gap-1 rounded-lg pe-1 hover:bg-surface',
    handle: [
      'flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-xs',
      'text-muted/60 select-none hover:text-foreground active:cursor-grabbing',
    ],
    toggle: [
      'flex h-9 min-w-0 grow cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-start',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
    ],
    icon: 'size-4 shrink-0 text-muted',
    label: 'min-w-0 shrink-0 truncate text-sm font-medium text-foreground max-w-[60%]',
    detail: 'flex min-w-0 grow items-center justify-between gap-2',
    target: 'flex min-w-0 items-center gap-1 truncate text-xs text-muted',
    external: 'size-3 shrink-0',
    editor: 'flex flex-col gap-3 px-3 pt-1 pb-3 ps-9',
    fields: '@container grid gap-2',
    targetLabel: 'text-xs font-medium text-foreground',
    targetChip: [
      'flex h-8 min-w-0 items-center gap-2 rounded-md border border-border bg-surface ps-2.5 pe-1',
      'aria-invalid:border-danger',
    ],
    targetTitle: 'min-w-0 grow truncate text-xs text-foreground',
    targetNote: 'text-2xs leading-normal text-muted',
    nested: 'ms-6 flex flex-col gap-px border-s border-border ps-2',
    empty: [
      'my-1 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted',
      'data-[drop=inside]:border-accent data-[drop=inside]:text-foreground',
    ],
  },
})

/** A word beside a row whose target is not what the header will show. */
const problemStyles = tv({
  base: 'flex shrink-0 items-center gap-1.5 text-2xs font-medium whitespace-nowrap',
  variants: {
    tone: { warning: 'text-warning', danger: 'text-danger', quiet: 'text-muted' },
  },
})

const dotStyles = tv({
  base: 'size-1.5 rounded-full',
  variants: { tone: { warning: 'bg-warning', danger: 'bg-danger', quiet: 'bg-muted' } },
})

/** What a row needs to be dragged, and to be dropped on. */
export interface RowDrag {
  readonly handle: {
    readonly draggable: true
    readonly onDragStart: (event: DragEvent) => void
    readonly onDragEnd: () => void
  }
  readonly target: {
    readonly onDragOver: (event: DragEvent<HTMLElement>) => void
    readonly onDragLeave: () => void
    readonly onDrop: (event: DragEvent<HTMLElement>) => void
  }
  readonly dragging: boolean
  readonly drop: 'before' | 'after' | 'inside' | undefined
}

/** A row's moves and actions, for its "⋯" menu and its keyboard shortcuts. */
export interface RowActions {
  /** The row's name in every control that acts on it: "More actions for Overview". */
  readonly name: string
  readonly canMoveUp: boolean
  readonly canMoveDown: boolean
  readonly onMove: (by: -1 | 1) => void
  /** Everything else the "⋯" menu offers: nesting, removing. */
  readonly more: readonly MenuItem[]
}

/** Whether a row is open, and how it asks to open or close. */
export interface RowOpening {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export type TargetLookup = 'loading' | 'ready' | 'failed'

type ProblemTone = 'warning' | 'danger' | 'quiet'

interface Problem {
  readonly text: string
  readonly tone: ProblemTone
}

interface MenuRowProps {
  readonly icon: ReactNode
  readonly label: string
  /** What it points at, in a quieter ink: a title, a collection, a host, a count. */
  readonly target: ReactNode
  readonly problem: Problem | null
  readonly actions: RowActions
  readonly drag: RowDrag
  readonly opening: RowOpening
  /** The row's fields, shown while it is open. */
  readonly editor: ReactNode
  /** What sits under the line whether or not it is open: a dropdown's links. */
  readonly children?: ReactNode
}

/** One row: a compact line that opens into its fields. */
function MenuRow({
  icon,
  label,
  target,
  problem,
  actions,
  drag,
  opening,
  editor,
  children,
}: MenuRowProps) {
  const styles = menuRowStyles()
  const ids = useId()
  const toggle = useRef<HTMLButtonElement | null>(null)

  const moves: MenuItem[] = [
    { label: 'Move up', disabled: !actions.canMoveUp, onSelect: () => actions.onMove(-1) },
    { label: 'Move down', disabled: !actions.canMoveDown, onSelect: () => actions.onMove(1) },
  ]

  function onToggleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!event.altKey) return
    if (event.key === 'ArrowUp' && actions.canMoveUp) actions.onMove(-1)
    else if (event.key === 'ArrowDown' && actions.canMoveDown) actions.onMove(1)
    else return
    event.preventDefault()
  }

  const { onOpenChange } = opening
  /**
   * Escape anywhere in the open fields closes them and puts focus back on the
   * row, as it would leaving any disclosure. Listened for on the element
   * itself, because the fields are a group of controls rather than a control,
   * and a keyboard handler belongs on something interactive in React's props.
   * A field that answers Escape itself — the target combobox closing its
   * popup — marks the event handled, and this leaves it alone.
   */
  const closeOnEscape = useCallback(
    (fields: HTMLDivElement | null) => {
      if (fields === null) return undefined
      const onKeyDown = (event: globalThis.KeyboardEvent): void => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        onOpenChange(false)
        toggle.current?.focus()
      }
      fields.addEventListener('keydown', onKeyDown)
      return () => {
        fields.removeEventListener('keydown', onKeyDown)
      }
    },
    [onOpenChange],
  )

  return (
    <li
      className={styles.item()}
      data-open={opening.open}
      data-dragging={drag.dragging}
      data-drop={drag.drop}
      {...drag.target}
    >
      <div className={styles.line()}>
        <span aria-hidden="true" title="Drag to move" className={styles.handle()} {...drag.handle}>
          ⠿
        </span>
        <button
          ref={toggle}
          type="button"
          aria-expanded={opening.open}
          aria-controls={`${ids}-editor`}
          // Named by its label alone; what it points at, and any problem, describe it.
          aria-labelledby={`${ids}-label`}
          aria-describedby={`${ids}-detail`}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          className={styles.toggle()}
          onClick={() => {
            opening.onOpenChange(!opening.open)
          }}
          onKeyDown={onToggleKeyDown}
        >
          {icon}
          <span id={`${ids}-label`} className={styles.label()}>
            {label}
          </span>
          <span id={`${ids}-detail`} className={styles.detail()}>
            <span className={styles.target()}>{target}</span>
            {problem === null ? undefined : (
              <span className={problemStyles({ tone: problem.tone })}>
                <span aria-hidden="true" className={dotStyles({ tone: problem.tone })} />
                {problem.text}
              </span>
            )}
          </span>
        </button>
        <Menu label={actions.name} items={[...moves, ...actions.more]} />
      </div>
      {opening.open ? (
        <div
          id={`${ids}-editor`}
          ref={closeOnEscape}
          role="group"
          aria-labelledby={`${ids}-label`}
          className={styles.editor()}
        >
          {editor}
        </div>
      ) : undefined}
      {children}
    </li>
  )
}

const KIND_ICONS = {
  document: DocumentIcon,
  collection: CollectionIcon,
  url: LinkIcon,
} as const

const NOUNS = { document: 'document', collection: 'collection' } as const

/** A word for a link that is not what the header will show, or null when it is. */
function linkProblem(
  link: PublicMenuLink,
  target: PublicMenuTarget | undefined,
  lookup: TargetLookup,
): Problem | null {
  const issues = itemIssues(link)
  if (issues.href !== undefined) return { text: 'Check the address', tone: 'danger' }
  if (issues.label !== undefined) return { text: 'Needs a label', tone: 'danger' }
  if (link.kind === 'url') return null
  if (target === undefined)
    return lookup === 'failed' ? { text: 'Not checked', tone: 'quiet' } : null
  if (target.status === 'missing') return { text: 'Deleted', tone: 'danger' }
  if (target.status === 'not-public') return { text: 'Not public', tone: 'warning' }
  return null
}

/** What a link points at, as the row's quiet second line says it. */
function linkTarget(link: PublicMenuLink, target: PublicMenuTarget | undefined): string {
  if (link.kind === 'url') return addressHost(link.href)
  if (target === undefined) return ''
  if (target.status === 'missing') return `A deleted ${NOUNS[link.kind]}`
  const place = target.collectionName ?? target.workspaceName
  // A link that follows its title already shows it as its label; say only where it is.
  const followsTitle = link.label === undefined || link.label === ''
  return (followsTitle ? [place] : [target.title, place]).filter(Boolean).join(' · ')
}

/** An address as somebody would say it: its host, or the path for one on this site. */
function addressHost(href: string): string {
  try {
    return new URL(href).host.replace(/^www\./u, '')
  } catch {
    return href
  }
}

/** What the row and the header call a link. */
function linkLabel(link: PublicMenuLink, target: PublicMenuTarget | undefined): string {
  if (link.label !== undefined && link.label !== '') return link.label
  if (link.kind === 'url') return 'Untitled link'
  if (target?.status === 'missing') return `Deleted ${NOUNS[link.kind]}`
  return target?.title ?? '…'
}

export interface LinkRowProps {
  readonly link: PublicMenuLink
  readonly target: PublicMenuTarget | undefined
  readonly lookup: TargetLookup
  readonly onChange: (next: PublicMenuLink) => void
  readonly actions: RowActions
  readonly drag: RowDrag
  readonly opening: RowOpening
}

/** One link, standalone or inside a dropdown. */
export function LinkRow({ link, target, lookup, onChange, actions, drag, opening }: LinkRowProps) {
  const styles = menuRowStyles()
  const Icon = KIND_ICONS[link.kind]
  const external = link.kind === 'url' && isExternalAddress(link.href)
  return (
    <MenuRow
      icon={<Icon className={styles.icon()} />}
      label={linkLabel(link, target)}
      target={
        <>
          <span className="truncate">{linkTarget(link, target)}</span>
          {external ? <ExternalIcon className={styles.external()} /> : undefined}
        </>
      }
      problem={linkProblem(link, target, lookup)}
      actions={actions}
      drag={drag}
      opening={opening}
      editor={<LinkFields link={link} target={target} lookup={lookup} onChange={onChange} />}
    />
  )
}

/** A link's fields: its label, and what it points at. */
function LinkFields({
  link,
  target,
  lookup,
  onChange,
}: Pick<LinkRowProps, 'link' | 'target' | 'lookup' | 'onChange'>) {
  const styles = menuRowStyles()
  const issues = itemIssues(link)
  const [repointing, setRepointing] = useState(false)
  const title = link.kind === 'url' ? undefined : (target?.title ?? undefined)
  // Quiet, and only while the label is empty: that is when it follows the title.
  const titleHint =
    link.kind === 'url' || (link.label !== undefined && link.label !== '')
      ? undefined
      : `Follows the ${NOUNS[link.kind]}’s title`

  function repoint(next: PublicMenuLink): void {
    setRepointing(false)
    // The label stays what the administrator wrote; an address needs one, so
    // it keeps theirs or takes the one the picker suggested.
    const label = link.label === undefined || link.label === '' ? undefined : link.label
    onChange(
      next.kind === 'url'
        ? { ...next, label: label ?? next.label }
        : { ...next, ...(label === undefined ? {} : { label }) },
    )
  }

  return (
    <>
      <div className={styles.fields()}>
        <Input
          label="Label"
          value={link.label ?? ''}
          maxLength={MAX_LABEL_LENGTH}
          placeholder={title ?? (link.kind === 'url' ? 'Status' : '')}
          {...(titleHint === undefined ? {} : { description: titleHint })}
          {...(issues.label === undefined ? {} : { error: issues.label })}
          onChange={(event) => {
            const label = event.target.value
            if (link.kind === 'url') onChange({ ...link, label })
            else onChange(label === '' ? { kind: link.kind, id: link.id } : { ...link, label })
          }}
        />
        {link.kind === 'url' ? (
          <Input
            label="Address"
            value={link.href}
            inputMode="url"
            maxLength={MAX_URL_LENGTH}
            placeholder="https://status.example.com"
            {...(issues.href === undefined ? {} : { error: issues.href })}
            onChange={(event) => {
              onChange(withAddress(link, event.target.value))
            }}
          />
        ) : repointing ? (
          <MenuTargetPicker
            label="Links to"
            focusOnMount
            onPick={repoint}
            onDismiss={() => {
              setRepointing(false)
            }}
          />
        ) : (
          <TargetSummary
            link={link}
            target={target}
            lookup={lookup}
            onRepoint={() => {
              setRepointing(true)
            }}
          />
        )}
      </div>
      {link.kind === 'url' && isExternalAddress(link.href) ? (
        <ToggleField
          label="Hide this site from the destination"
          description="The destination sees your site’s address, never the page."
          checked={hidesReferrer(link)}
          onCheckedChange={(hidden) => {
            onChange(withReferrerHidden(link, hidden))
          }}
        />
      ) : undefined}
    </>
  )
}

/** What a document or collection link points at, and the way to point it elsewhere. */
function TargetSummary({
  link,
  target,
  lookup,
  onRepoint,
}: {
  readonly link: Exclude<PublicMenuLink, { kind: 'url' }>
  readonly target: PublicMenuTarget | undefined
  readonly lookup: TargetLookup
  readonly onRepoint: () => void
}) {
  const styles = menuRowStyles()
  const labelId = useId()
  const missing = target?.status === 'missing'
  return (
    <div role="group" aria-labelledby={labelId} className="flex min-w-0 flex-col gap-1">
      <span id={labelId} className={styles.targetLabel()}>
        Links to
      </span>
      <div className={styles.targetChip()} aria-invalid={missing}>
        <span className={styles.targetTitle()}>
          {target?.title ?? (missing ? `A deleted ${NOUNS[link.kind]}` : '…')}
        </span>
        <Button size="sm" variant="ghost" onClick={onRepoint}>
          {missing ? 'Choose another' : 'Change'}
        </Button>
      </div>
      <p className={styles.targetNote()}>{targetNote(link, target, lookup)}</p>
    </div>
  )
}

/** The sentence under a target: where it is, and what readers see of it. */
function targetNote(
  link: Exclude<PublicMenuLink, { kind: 'url' }>,
  target: PublicMenuTarget | undefined,
  lookup: TargetLookup,
): string {
  const noun = NOUNS[link.kind]
  if (target === undefined) {
    return lookup === 'failed' ? `Could not check this ${noun} just now.` : 'Looking it up…'
  }
  const place = [target.workspaceName, target.collectionName].filter(Boolean).join(' / ')
  switch (target.status) {
    case 'public':
      return `${place} · On the web`
    case 'not-public':
      return `${place} · Not on the web yet, so the header leaves it out.`
    case 'missing':
      return `This ${noun} no longer exists. Choose another, or remove the link.`
  }
}

export interface GroupRowProps {
  readonly group: PublicMenuGroup
  readonly onLabelChange: (label: string) => void
  readonly actions: RowActions
  readonly drag: RowDrag
  readonly opening: RowOpening
  /** Dropping on the empty dropdown's placeholder. */
  readonly emptyDrop: RowDrag['target'] & { readonly drop: RowDrag['drop'] }
  /** The dropdown's links, already rendered. */
  readonly children: ReactNode
  /** The composer for a new link in this dropdown, or its button. */
  readonly composer: ReactNode
}

/** A word for a dropdown the header cannot show yet, or null. */
function groupProblem(issues: ReturnType<typeof itemIssues>): Problem | null {
  if (issues.label !== undefined) return { text: 'Needs a label', tone: 'danger' }
  if (issues.items !== undefined) return { text: 'Empty', tone: 'danger' }
  return null
}

/** A dropdown: its label, and the links it opens to, indented under it. */
export function GroupRow({
  group,
  onLabelChange,
  actions,
  drag,
  opening,
  emptyDrop,
  children,
  composer,
}: GroupRowProps) {
  const styles = menuRowStyles()
  const issues = itemIssues(group)
  const { drop, ...emptyTarget } = emptyDrop
  const count = group.items.length
  return (
    <MenuRow
      icon={<DropdownIcon className={styles.icon()} />}
      label={group.label === '' ? 'Untitled dropdown' : group.label}
      target={count === 0 ? 'No links' : `${count} ${count === 1 ? 'link' : 'links'}`}
      problem={groupProblem(issues)}
      actions={actions}
      drag={drag}
      opening={opening}
      editor={
        <Input
          label="Dropdown label"
          value={group.label}
          maxLength={MAX_LABEL_LENGTH}
          placeholder="Products"
          {...(issues.label === undefined ? {} : { error: issues.label })}
          onChange={(event) => {
            onLabelChange(event.target.value)
          }}
        />
      }
    >
      <div className={styles.nested()}>
        {count === 0 ? (
          <p className={styles.empty()} data-drop={drop} {...emptyTarget}>
            No links yet. Drag a link here, or add one.
          </p>
        ) : (
          <ol aria-label={`Links in ${actions.name}`} className="flex flex-col gap-px">
            {children}
          </ol>
        )}
        {composer}
      </div>
    </MenuRow>
  )
}
