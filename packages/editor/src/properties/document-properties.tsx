import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

import {
  DEPRECATED_CANNOT_BE_VERIFIED,
  describeInterval,
  documentFacts,
  isLifecycleState,
  lifecycleLabel,
  nextReviewDue,
  reviewFreshness,
  verificationLapsed,
  type DocumentFacts,
} from '@quill/domain'
import { readFrontMatter } from '@quill/markdown'
import {
  Avatar,
  Button,
  ChevronRightIcon,
  DocumentByline,
  MenuButton,
  PlusIcon,
  WarningIcon,
  absoluteDate,
  tv,
  type BylineField,
  type BylineLifecycle,
  type BylineOwner,
  type ChoiceMenuOption,
} from '@quill/ui'

import {
  propertyIssues,
  readProperties,
  unansweredQuestions,
  writeLifecycle,
  writeProperty,
  writeValue,
} from './front-matter.ts'
import type { PropertyField } from './front-matter.ts'
import { systemClock, type Clock } from '../drafts/clock.ts'
import type { PeopleDirectory } from './people.ts'
import {
  ChoiceEditor,
  DateEditor,
  PeopleEditor,
  ReplacementEditor,
  ReviewEditor,
  TagsEditor,
  TextEditor,
  ValueButton,
  today,
  type DocumentSearch,
} from './property-editors.tsx'

/**
 * A document's properties, where its front matter used to be (ADR-005;
 * `docs/design/properties.md`).
 *
 * The author meets the same byline a reader does — owners as people, the
 * status in words, the review date, the tags — with every value the control
 * that edits it: press it and its editor opens against it. Nothing that is not
 * set takes room; "Add property" offers what could be. "All properties" opens
 * the full list: every known field, the template's questions, and every key
 * this release has no control for, shown as it is and editable as YAML by
 * whoever wants to (AGENTS.md rule 7).
 *
 * Two rules from before still shape it. Nothing is hidden, and nothing is
 * invented: the record goes out of here the way it came in, with one value
 * changed, so key order, comments and unknown fields survive the round trip
 * `writeFrontMatter` performs downstream. And every change is one edit of the
 * document, so the host makes it a step of the editor's undo history; Ctrl+Z
 * pressed here is passed to that history.
 */

export const documentPropertiesStyles = tv({
  slots: {
    root: '@container flex flex-col gap-3',
    line: '',
    tool: [
      'inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs text-muted',
      'transition-colors ease-standard hover:bg-surface hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
      'pointer-coarse:h-11',
    ],
    chevron: 'size-3 transition-transform ease-standard group-aria-expanded:rotate-90',
    attention: [
      'inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs',
      'font-medium text-warning hover:bg-warning-subtle',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
    ],
    attentionIcon: 'size-3.5 shrink-0',
    reason: 'text-xs text-muted',
    panel: 'flex flex-col gap-5 rounded-lg border border-border bg-surface/40 p-4',
    rows: 'grid grid-cols-1 gap-x-6 gap-y-2 @md:grid-cols-[minmax(7rem,auto)_1fr]',
    rowLabel: 'pt-0.5 text-xs font-medium text-muted',
    rowValue: 'flex min-w-0 flex-col items-start gap-0.5 text-sm text-foreground',
    rowHelp: 'text-2xs text-muted',
    rowError: 'text-2xs text-danger',
    group: 'flex flex-col gap-2',
    groupLabel: 'section-label',
    other: 'grid grid-cols-1 gap-x-4 gap-y-1 @md:grid-cols-[minmax(7rem,auto)_1fr]',
    otherKey: 'font-mono text-2xs text-muted',
    otherValue: 'min-w-0 font-mono text-2xs break-all text-foreground',
    source: [
      'min-h-40 w-full rounded-md border border-border bg-surface-raised p-2.5 font-mono text-xs',
      'text-foreground focus-visible:outline-2 focus-visible:outline-offset-2',
      'focus-visible:outline-focus-ring aria-invalid:border-danger',
    ],
    sourceActions: 'flex flex-wrap items-center gap-2',
    sourceError: 'text-2xs text-danger',
    // Spaced by margins, not a column gap: see `.byline-list` in `byline.css`.
    tokenList: 'inline-flex flex-wrap items-center gap-y-1',
    token: 'byline-tag badge me-2 last:me-0',
    person: 'byline-person me-3 last:me-0',
  },
})

export interface DocumentPropertiesProps {
  /** The draft's front matter record, exactly as it is stored. */
  readonly frontMatter: Readonly<Record<string, unknown>>
  /** The document's first heading, which is its title when none is declared. */
  readonly headingTitle?: string | undefined
  readonly editable?: boolean
  /** Why the values cannot be changed, said beside them (`docs/design/feedback.md`). */
  readonly readOnlyReason?: string | undefined
  /** Open "All properties" on first render. It also opens when something needs attention. */
  readonly defaultOpen?: boolean
  /** Who an owner can be. Without it, owners are written and shown as typed. */
  readonly people?: PeopleDirectory | undefined
  /** Tags to suggest: the organisation's labels (ADR-037), most usefully. */
  readonly tagSuggestions?: readonly string[] | undefined
  /**
   * Who is editing, from the session: the person a verification is stamped
   * with. Never typed. Without it, Verified is offered disabled, with why.
   */
  readonly currentPerson?: { readonly value: string; readonly name: string } | undefined
  /** Finds the page that replaces a deprecated one: the link editor's document search. */
  readonly searchDocuments?: DocumentSearch | undefined
  /** The title of the page `supersededBy` names, when the host could find one this reader may open. */
  readonly replacementTitle?: string | undefined
  /** The front matter's YAML, for editing it as source; absent, that is not offered. */
  readonly source?: string | undefined
  readonly onSourceChange?: ((source: string) => void) | undefined
  /** Ctrl+Z and Ctrl+Shift+Z (Ctrl+Y) pressed on the line, for the document's history. */
  readonly onUndo?: (() => void) | undefined
  readonly onRedo?: (() => void) | undefined
  /** What relative dates are counted from, and what "today" is. */
  readonly clock?: Clock | undefined
  readonly className?: string | undefined
  /** The whole record, with one value changed. Never a patch: order matters. */
  onChange(frontMatter: Record<string, unknown>): void
}

/** Where a property shows in the line once it is set; layout is not a reader's fact. */
const BYLINE_FIELDS_OF: Readonly<Record<LineField, readonly BylineField[]>> = {
  owners: ['owners'],
  lifecycle: ['lifecycle'],
  type: ['type'],
  tags: ['tags'],
  review: ['review'],
  layout: [],
}

/** The facts the line shows, and the order "Add property" offers them in. */
type LineField = 'owners' | 'lifecycle' | 'type' | 'tags' | 'review' | 'layout'

const ADDABLE: readonly { readonly field: LineField; readonly label: string }[] = [
  { field: 'owners', label: 'Owners' },
  { field: 'lifecycle', label: 'Lifecycle' },
  { field: 'type', label: 'Type' },
  { field: 'tags', label: 'Tags' },
  { field: 'review', label: 'Review' },
  { field: 'layout', label: 'Layout' },
]

function isSet(field: LineField, facts: DocumentFacts, model: ReturnType<typeof readProperties>) {
  switch (field) {
    case 'owners':
      return facts.owners.length > 0
    case 'tags':
      return facts.tags.length > 0
    case 'lifecycle':
      return facts.lifecycle !== undefined
    case 'review':
      return (
        valueOf(model, 'review.interval') !== '' || valueOf(model, 'review.lastReviewed') !== ''
      )
    default:
      return valueOf(model, field) !== ''
  }
}

function fieldOf(model: ReturnType<typeof readProperties>, key: string): PropertyField | undefined {
  return [...model.fields, ...model.questions].find((field) => field.key === key)
}

function valueOf(model: ReturnType<typeof readProperties>, key: string): string {
  return fieldOf(model, key)?.value ?? ''
}

function isTextTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

const NO_SUGGESTIONS: readonly string[] = []

/** What each lifecycle state means, said under it in the menu. */
const LIFECYCLE_MEANINGS: Readonly<Record<string, string>> = {
  '': 'Nothing is said about where this page stands.',
  'in-review': 'Being checked. Readers are told not to rely on it yet.',
  verified: 'Checked and correct. Lapses when the review falls due.',
  deprecated: 'Kept for reference. Readers are pointed elsewhere.',
}

/** Focus a control once the render that puts it on screen has happened. */
function focusSoon(find: () => HTMLElement | null | undefined): void {
  setTimeout(() => {
    find()?.focus()
  }, 0)
}

export function DocumentProperties({
  frontMatter,
  headingTitle,
  editable = true,
  readOnlyReason,
  defaultOpen = false,
  people,
  tagSuggestions = NO_SUGGESTIONS,
  currentPerson,
  searchDocuments,
  replacementTitle,
  source,
  onSourceChange,
  onUndo,
  onRedo,
  clock = systemClock,
  className,
  onChange,
}: DocumentPropertiesProps) {
  const now = new Date(clock.now())
  const ids = useId()
  const styles = documentPropertiesStyles()
  const model = readProperties(frontMatter, { headingTitle })
  const facts = documentFacts(frontMatter)
  const issues = propertyIssues(model)
  const unanswered = unansweredQuestions(model)

  const [open, setOpen] = useState(() => defaultOpen || issues.length > 0 || unanswered.length > 0)
  const [openEditor, setOpenEditor] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<LineField | undefined>(undefined)
  const root = useRef<HTMLElement>(null)
  const panelId = `${ids}-panel`
  const triggerId = (place: string, key: string) => `${ids}-${place}-${key.replaceAll('.', '-')}`

  function write(path: string, value: unknown): void {
    onChange(writeValue(frontMatter, path, value))
  }

  /**
   * The lifecycle's choices, each with what it means; Verified disabled, with
   * why, when it cannot be chosen: from Deprecated (`canMoveLifecycle`), or
   * with nobody signed in to stamp it with.
   */
  function lifecycleOptions(
    options: readonly ChoiceMenuOption[],
    adding: boolean,
  ): readonly ChoiceMenuOption[] {
    const deprecated = facts.lifecycle?.state === 'deprecated'
    return options
      .filter((option) => !adding || option.value !== '')
      .map((option) => {
        const blocked =
          option.value !== 'verified'
            ? undefined
            : deprecated
              ? DEPRECATED_CANNOT_BE_VERIFIED
              : currentPerson === undefined
                ? 'Verifying records who verified it, and nobody is signed in.'
                : undefined
        return {
          ...option,
          description: blocked ?? LIFECYCLE_MEANINGS[option.value],
          ...(blocked === undefined ? {} : { disabled: true }),
        }
      })
  }

  /**
   * Whether an editor is open, and what closing it does. A property being
   * added leaves the line again when its editor closes, whatever was chosen:
   * if a value was written, the line now shows it in its own place.
   */
  function editorProps(key: string) {
    return {
      open: openEditor === key,
      onOpenChange: (next: boolean) => {
        setOpenEditor(next ? key : undefined)
        if (!next && key.startsWith('pending:')) finishAdding()
      },
    }
  }

  /* --- What each value opens --------------------------------------------- */

  function lineEditor(field: LineField, place: string, trigger: ReactElement): ReactNode {
    const key = `${place}:${field}`
    switch (field) {
      case 'owners':
        return (
          <PeopleEditor
            label="Owners"
            values={facts.owners}
            directory={people}
            trigger={trigger}
            {...editorProps(key)}
            onWrite={(values) => {
              write('owners', values)
            }}
          />
        )
      case 'lifecycle': {
        const property = fieldOf(model, 'status')
        /* v8 ignore next -- the lifecycle is always in the model. */
        if (property === undefined) return undefined
        return (
          <ChoiceEditor
            label="Lifecycle"
            value={property.value}
            options={lifecycleOptions(property.options ?? [], place === 'pending')}
            trigger={trigger}
            {...editorProps(key)}
            onWrite={(value) => {
              if (currentPerson === undefined && value === 'verified') return
              onChange({
                ...writeLifecycle(frontMatter, isLifecycleState(value) ? value : undefined, {
                  by: currentPerson?.value ?? '',
                  today: today(now),
                }),
              })
            }}
          />
        )
      }
      case 'layout': {
        const property = fieldOf(model, field)
        /* v8 ignore next -- both are always in the model. */
        if (property === undefined) return undefined
        return (
          <ChoiceEditor
            label={property.label}
            value={property.value}
            options={
              place === 'pending'
                ? (property.options ?? []).filter((option) => option.value !== '')
                : (property.options ?? [])
            }
            trigger={trigger}
            {...editorProps(key)}
            onWrite={(value) => {
              write(field, value === '' ? undefined : value)
            }}
          />
        )
      }
      case 'type':
        return (
          <TextEditor
            label="Type"
            value={valueOf(model, 'type')}
            trigger={trigger}
            {...editorProps(key)}
            onWrite={(value) => {
              write('type', value.trim() === '' ? undefined : value.trim())
            }}
          />
        )
      case 'tags':
        return (
          <TagsEditor
            values={facts.tags}
            suggestions={tagSuggestions}
            trigger={trigger}
            {...editorProps(key)}
            onWrite={(values) => {
              write('tags', values)
            }}
          />
        )
      case 'review':
        return (
          <ReviewEditor
            value={{
              interval: valueOf(model, 'review.interval'),
              lastReviewed: valueOf(model, 'review.lastReviewed'),
            }}
            now={now}
            trigger={trigger}
            {...editorProps(key)}
            onWrite={(next) => {
              let record: Record<string, unknown> = { ...frontMatter }
              for (const [part, value] of Object.entries(next)) {
                record = writeValue(record, `review.${part}`, value === '' ? undefined : value)
              }
              onChange(record)
            }}
          />
        )
    }
  }

  function questionEditor(question: PropertyField, trigger: ReactElement): ReactNode {
    const key = `question:${question.key}`
    switch (question.kind) {
      case 'select':
        return (
          <ChoiceEditor
            label={question.label}
            value={question.value}
            options={(question.options ?? []).map((option) =>
              option.value === '' ? { ...option, label: 'Not answered' } : option,
            )}
            trigger={trigger}
            {...editorProps(key)}
            onWrite={(value) => {
              onChange(writeProperty(frontMatter, question, value))
            }}
          />
        )
      case 'date':
        return (
          <DateEditor
            label={question.label}
            value={question.value}
            now={now}
            trigger={trigger}
            {...editorProps(key)}
            onWrite={(value) => {
              write(question.key, value)
            }}
          />
        )
      case 'people':
        return (
          <PeopleEditor
            label={question.label}
            values={question.values ?? []}
            directory={people}
            trigger={trigger}
            {...editorProps(key)}
            onWrite={(values) => {
              write(question.key, values)
            }}
          />
        )
      default:
        return (
          <TextEditor
            label={question.label}
            value={question.value}
            trigger={trigger}
            {...editorProps(key)}
            onWrite={(value) => {
              onChange(writeProperty(frontMatter, question, value))
            }}
          />
        )
    }
  }

  /* --- The line ------------------------------------------------------------ */

  const ownerNames: readonly BylineOwner[] = facts.owners.map((owner) => {
    const name = people?.nameOf(owner)
    return { label: name ?? owner, person: name !== undefined }
  })
  const lastReviewed =
    facts.lastReviewed === undefined ? undefined : new Date(`${facts.lastReviewed}T00:00:00Z`)
  const due =
    lastReviewed === undefined || facts.reviewInterval === undefined
      ? undefined
      : nextReviewDue(facts.reviewInterval, lastReviewed)
  const freshness = due === undefined ? undefined : reviewFreshness(due, now)
  const lifecycle: BylineLifecycle | undefined = (() => {
    const stated = facts.lifecycle
    if (stated?.state !== 'verified') return stated
    const by = stated.verifiedBy
    return {
      state: 'verified',
      // Named as an owner is: the session's own name for the person editing,
      // the directory's for anyone else, the address only when neither knows.
      by:
        by === undefined
          ? undefined
          : by === currentPerson?.value
            ? currentPerson.name
            : (people?.nameOf(by) ?? by),
      at: stated.verifiedAt === undefined ? undefined : new Date(`${stated.verifiedAt}T00:00:00Z`),
      lapsed: verificationLapsed(stated, due, now),
    }
  })()
  const lifecycleWords =
    lifecycle === undefined
      ? ''
      : lifecycle.state === 'verified' && lifecycle.lapsed === true
        ? 'Verification lapsed'
        : [
            lifecycleLabel(lifecycle.state),
            lifecycle.state === 'verified' && lifecycle.by !== undefined
              ? `by ${lifecycle.by}`
              : undefined,
            lifecycle.state === 'verified' && lifecycle.at !== undefined
              ? absoluteDate(lifecycle.at)
              : undefined,
          ]
            .filter((part) => part !== undefined)
            .join(', ')
  const replacedBy =
    facts.lifecycle?.state === 'deprecated' ? facts.lifecycle.supersededBy : undefined
  const reviewInWords = [
    lastReviewed === undefined ? undefined : `Reviewed ${absoluteDate(lastReviewed)}`,
    due === undefined
      ? undefined
      : `${due < now ? 'overdue since' : 'next due'} ${absoluteDate(due)}`,
    due === undefined && facts.reviewInterval !== undefined
      ? `Review every ${describeInterval(facts.reviewInterval)}`
      : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(', ')

  /** The accessible name of a value's button: the property, then what it says. */
  function nameOf(field: BylineField): string {
    switch (field) {
      case 'owners':
        return `Owners: ${ownerNames.map((owner) => owner.label).join(', ')}`
      case 'lifecycle':
        return `Lifecycle: ${lifecycleWords}`
      case 'type':
        return `Type: ${facts.type ?? ''}`
      case 'tags':
        return `Tags: ${facts.tags.join(', ')}`
      default:
        return `Review: ${reviewInWords}`
    }
  }

  /** What a value shows inside its button; a list is spans, because a button holds no list. */
  function contentOf(field: BylineField, value: ReactNode): ReactNode {
    if (field === 'owners') {
      return (
        <span className={styles.tokenList()}>
          {ownerNames.map((owner) => (
            <span key={owner.label} data-person={owner.person} className={styles.person()}>
              <Avatar name={owner.label} />
              {owner.label}
            </span>
          ))}
        </span>
      )
    }
    if (field === 'tags') {
      return (
        <span className={styles.tokenList()}>
          {facts.tags.map((tag) => (
            <span key={tag} className={styles.token()}>
              {tag}
            </span>
          ))}
        </span>
      )
    }
    return value
  }

  const lineFieldOf: Readonly<Record<BylineField, LineField | undefined>> = {
    owners: 'owners',
    lifecycle: 'lifecycle',
    type: 'type',
    tags: 'tags',
    review: 'review',
    updated: undefined,
  }

  function renderValue(field: BylineField, value: ReactNode): ReactNode {
    const line = lineFieldOf[field]
    /* v8 ignore next -- the editor's line never shows "updated". */
    if (line === undefined) return value
    const editor = lineEditor(
      line,
      `line-${field}`,
      <ValueButton id={triggerId('line', field)} aria-label={nameOf(field)}>
        {contentOf(field, value)}
      </ValueButton>,
    )
    if (field !== 'lifecycle' || facts.lifecycle?.state !== 'deprecated') return editor
    return (
      <>
        {editor}
        {replacementControl()}
      </>
    )
  }

  /**
   * A deprecated page's replacement, beside its lozenge in the line: what
   * readers will be sent to, or the way to choose it.
   */
  function replacementControl(): ReactNode {
    const current =
      replacedBy === undefined ? undefined : { id: replacedBy, title: replacementTitle }
    const words =
      current === undefined ? undefined : `replaced by ${current.title ?? 'a page you cannot open'}`
    return (
      <ReplacementEditor
        current={current}
        search={searchDocuments}
        excludeId={typeof frontMatter['id'] === 'string' ? frontMatter['id'] : undefined}
        trigger={
          <ValueButton
            id={triggerId('line', 'replacement')}
            aria-label={
              words === undefined
                ? 'Replaced by: Not set'
                : `Replaced by: ${current?.title ?? 'a page you cannot open'}`
            }
          >
            {words === undefined ? (
              <span className="text-muted italic">Add replacement</span>
            ) : (
              words
            )}
          </ValueButton>
        }
        {...editorProps('line:replacement')}
        onWrite={(id) => {
          write('supersededBy', id)
        }}
      />
    )
  }

  const unset = ADDABLE.filter(({ field }) => !isSet(field, facts, model))

  function startAdding(field: LineField): void {
    setPending(field)
    // The menu hands focus back to its trigger as it closes; the new
    // property's editor opens once that has happened, and takes it.
    setTimeout(() => {
      setOpenEditor(`pending:${field}`)
    }, 0)
  }

  /**
   * The property being added has its editor closed. Focus goes to its value
   * in the line if one was written, and back to "Add property" if not, so it
   * is never left on a control that has gone.
   */
  function finishAdding(): void {
    const added = pending
    setPending(undefined)
    focusSoon(() => {
      const shown = BYLINE_FIELDS_OF[added ?? 'type']
        .map((field) => document.getElementById(triggerId('line', field)))
        .find((element) => element !== null)
      return shown ?? root.current?.querySelector<HTMLElement>('[data-add-property] button')
    })
  }

  function pendingEditor(field: LineField): ReactNode {
    const label = ADDABLE.find((entry) => entry.field === field)?.label ?? field
    return lineEditor(
      field,
      'pending',
      <ValueButton aria-label={`${label}: Not set`}>
        <span className="text-muted italic">{label}…</span>
      </ValueButton>,
    )
  }

  /* --- Keyboard ------------------------------------------------------------ */

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || isTextTarget(event.target)) return
    const key = event.key.toLowerCase()
    if (key === 'z' && !event.shiftKey && onUndo !== undefined) onUndo()
    else if (((key === 'z' && event.shiftKey) || key === 'y') && onRedo !== undefined) onRedo()
    else return
    event.preventDefault()
  }

  function reveal(selector: string): void {
    setOpen(true)
    focusSoon(() => root.current?.querySelector<HTMLElement>(selector))
  }

  /* --- Render -------------------------------------------------------------- */

  return (
    // The keys are the document's undo and redo, heard from whichever value
    // in the line has focus; every control in it is a real button or field.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={root}
      aria-label="Properties"
      className={styles.root({ className })}
      onKeyDown={onKeyDown}
    >
      <DocumentByline
        owners={ownerNames}
        lifecycle={lifecycle}
        type={facts.type}
        lastReviewed={lastReviewed}
        reviewDue={
          due === undefined
            ? undefined
            : { at: due, overdue: freshness === 'overdue', soon: freshness === 'due' }
        }
        reviewEvery={
          facts.reviewInterval === undefined ? undefined : describeInterval(facts.reviewInterval)
        }
        tags={facts.tags}
        now={now}
        className={styles.line()}
        {...(editable ? { renderValue } : {})}
      >
        {issues.map((issue) =>
          editable ? (
            <button
              key={issue.key}
              type="button"
              className={styles.attention()}
              onClick={() => {
                reveal(`#${triggerId('row', issue.key)}`)
              }}
            >
              <WarningIcon className={styles.attentionIcon()} />
              {issue.label}: {issue.error}
            </button>
          ) : (
            <span key={issue.key} className={styles.attention()}>
              <WarningIcon className={styles.attentionIcon()} />
              {issue.label}: {issue.error}
            </span>
          ),
        )}
        {unanswered.length === 0 ? undefined : (
          <button
            type="button"
            className={styles.attention()}
            onClick={() => {
              reveal(`#${triggerId('row', unanswered[0]?.key ?? '')}`)
            }}
          >
            <WarningIcon className={styles.attentionIcon()} />
            {unanswered.length === 1
              ? '1 question unanswered'
              : `${unanswered.length} questions unanswered`}
          </button>
        )}
        {pending === undefined ? undefined : pendingEditor(pending)}
        {!editable || unset.length === 0 ? undefined : (
          <span data-add-property="" className="contents">
            <MenuButton
              label="Add property"
              align="start"
              sections={[
                {
                  id: 'add',
                  entries: unset.map(({ field, label }) => ({
                    kind: 'action' as const,
                    label,
                    onSelect: () => {
                      startAdding(field)
                    },
                  })),
                },
              ]}
            >
              <span className={styles.tool()}>
                <PlusIcon className="size-3.5" />
                Add property
              </span>
            </MenuButton>
          </span>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          className={styles.tool({ className: 'group' })}
          onClick={() => {
            setOpen(!open)
          }}
        >
          <ChevronRightIcon className={styles.chevron()} />
          All properties
        </button>
      </DocumentByline>

      {editable || readOnlyReason === undefined ? undefined : (
        <p className={styles.reason()}>{readOnlyReason}</p>
      )}

      <section id={panelId} aria-label="All properties" hidden={!open} className={styles.panel()}>
        <dl className={styles.rows()}>
          {model.fields.map((field) => (
            <Row
              key={field.key}
              field={field}
              trigger={
                field.kind === 'readonly' || !editable
                  ? undefined
                  : rowTrigger(field, triggerId('row', field.key))
              }
              styles={styles}
            />
          ))}
        </dl>

        {model.questions.length === 0 ? undefined : (
          <div role="group" aria-labelledby={`${ids}-questions`} className={styles.group()}>
            {/* Not a heading: a document being written has an outline of its
                own to keep clean. */}
            <p id={`${ids}-questions`} className={styles.groupLabel()}>
              Template questions
            </p>
            <dl className={styles.rows()}>
              {model.questions.map((question) => (
                <Row
                  key={question.key}
                  field={question}
                  empty="Not answered"
                  trigger={
                    editable
                      ? questionEditor(
                          question,
                          <ValueButton
                            id={triggerId('row', question.key)}
                            aria-label={`${question.label}: ${displayOf(question, 'Not answered')}`}
                          >
                            <ValueText field={question} empty="Not answered" />
                          </ValueButton>,
                        )
                      : undefined
                  }
                  styles={styles}
                />
              ))}
            </dl>
          </div>
        )}

        {model.other.length === 0 && onSourceChange === undefined ? undefined : (
          <div role="group" aria-label="Other fields" className={styles.group()}>
            <p aria-hidden="true" className={styles.groupLabel()}>
              Other fields
            </p>
            {model.other.length === 0 ? undefined : (
              <dl className={styles.other()}>
                {model.other.map((entry) => (
                  <div key={entry.key} className="contents">
                    <dt className={styles.otherKey()}>{entry.key}</dt>
                    <dd className={styles.otherValue()}>{entry.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {onSourceChange === undefined || source === undefined || !editable ? undefined : (
              <SourceEditor
                source={source}
                id={frontMatter['id']}
                styles={styles}
                onApply={onSourceChange}
              />
            )}
          </div>
        )}
      </section>
    </section>
  )

  function rowTrigger(field: PropertyField, id: string): ReactNode {
    const trigger = (
      <ValueButton id={id} aria-label={`${field.label}: ${displayOf(field, 'Not set', people)}`}>
        <ValueText field={field} empty="Not set" people={people} />
      </ValueButton>
    )
    const line = field.key.startsWith('review.')
      ? 'review'
      : field.key === 'status'
        ? 'lifecycle'
        : field.key
    return lineEditor(line as LineField, `row-${field.key}`, trigger)
  }
}

/* --- Pieces --------------------------------------------------------------- */

type Styles = ReturnType<typeof documentPropertiesStyles>

/** A field's value in words, as its row and its button's name say it. */
function displayOf(field: PropertyField, empty: string, people?: PeopleDirectory): string {
  if (field.values !== undefined) {
    return field.values.length === 0
      ? empty
      : field.values.map((value) => people?.nameOf(value) ?? value).join(', ')
  }
  if (field.value === '') return empty
  if (field.kind === 'interval' && field.error === undefined) {
    return `Every ${describeInterval(field.value)}`
  }
  return field.options?.find((option) => option.value === field.value)?.label ?? field.value
}

function ValueText({
  field,
  empty,
  people,
}: {
  readonly field: PropertyField
  readonly empty: string
  readonly people?: PeopleDirectory | undefined
}) {
  const text = displayOf(field, empty, people)
  return text === empty ? <span className="text-muted italic">{text}</span> : <span>{text}</span>
}

function Row({
  field,
  trigger,
  empty = 'Not set',
  styles,
}: {
  readonly field: PropertyField
  readonly trigger: ReactNode
  readonly empty?: string
  readonly styles: Styles
}) {
  return (
    <div className="contents">
      <dt className={styles.rowLabel()}>
        {field.label}
        {field.required === true ? <span className="sr-only"> (required)</span> : undefined}
      </dt>
      <dd className={styles.rowValue()}>
        {trigger ?? <ValueText field={field} empty={empty} />}
        {field.help === undefined ? undefined : (
          <span className={styles.rowHelp()}>{field.help}</span>
        )}
        {field.error === undefined ? undefined : (
          <span className={styles.rowError()}>{field.error}</span>
        )}
      </dd>
    </div>
  )
}

function SourceEditor({
  source,
  id,
  styles,
  onApply,
}: {
  readonly source: string
  readonly id: unknown
  readonly styles: Styles
  onApply(source: string): void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(source)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const fieldId = useId()

  if (!editing) {
    return (
      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setText(source)
            setProblem(undefined)
            setEditing(true)
          }}
        >
          Edit as YAML
        </Button>
      </div>
    )
  }

  function apply(): void {
    const read = readFrontMatter(text)
    const [warning] = read.warnings
    if (warning !== undefined) {
      setProblem(`This is not valid YAML: ${warning.detail}`)
      return
    }
    if (read.value['id'] !== id) {
      setProblem('The id cannot change: it is how every link finds this document.')
      return
    }
    onApply(text.trimEnd())
    setEditing(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="text-xs font-medium text-foreground">
        Front matter
      </label>
      <textarea
        id={fieldId}
        spellCheck={false}
        className={styles.source()}
        value={text}
        aria-invalid={problem !== undefined}
        {...(problem === undefined ? {} : { 'aria-describedby': `${fieldId}-error` })}
        onChange={(event) => {
          setText(event.target.value)
        }}
      />
      {problem === undefined ? undefined : (
        <p id={`${fieldId}-error`} role="alert" className={styles.sourceError()}>
          {problem}
        </p>
      )}
      <div className={styles.sourceActions()}>
        <Button size="sm" onClick={apply}>
          Apply
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
