import { useEffect, useId, useState, type ComponentPropsWithRef, type ReactElement } from 'react'

import { describeInterval, isReviewInterval, nextReviewDue } from '@quill/domain'
import {
  Avatar,
  Button,
  ChoiceMenu,
  Combobox,
  Input,
  PropertyPopover,
  TokenInput,
  absoluteDate,
  relativeDate,
  tv,
  type ChoiceMenuOption,
  type ListboxGroup,
} from '@quill/ui'

import type { PeopleDirectory, Person } from './people.ts'
import type { DocumentLinkTarget } from '../slash/slash-item.ts'

/**
 * The editors behind each value in the properties line
 * (`docs/design/properties.md`, "Interacting").
 *
 * Each one is opened from the value it changes and writes through `onWrite`
 * with the value in its final shape — a list as a list, a date as
 * `YYYY-MM-DD` — so the record that comes out is the record the schema
 * expects. A text value is written once, when its editor is finished with,
 * never per keystroke: every write is an edit of the document, and an edit is
 * a step in its undo history.
 */

export const propertyEditorStyles = tv({
  slots: {
    // No negative margin to line the text up with a reader's byline: Chromium
    // leaves it out of the button's content size, and a list in it then wraps.
    trigger: [
      'inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm px-1',
      'text-start text-inherit transition-colors ease-standard',
      'hover:bg-surface data-[state=open]:bg-surface',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
      'pointer-coarse:min-h-11',
    ],
    placeholder: 'text-muted italic',
    form: 'flex flex-col gap-3',
    heading: 'text-xs font-medium text-foreground',
    presets: 'flex flex-wrap gap-1',
    preset: [
      'h-7 cursor-pointer rounded-full border border-border px-2.5 text-xs text-foreground',
      'hover:border-border-strong',
      'has-checked:border-accent has-checked:bg-accent-subtle has-checked:text-accent-ink',
      'has-focus-visible:outline-2 has-focus-visible:outline-offset-1',
      'has-focus-visible:outline-focus-ring',
    ],
    row: 'flex items-end gap-2',
    readout: 'text-xs text-muted',
    actions: 'flex flex-wrap justify-between gap-2',
    person: 'flex items-center gap-2',
    personDetail: 'truncate text-2xs text-muted',
  },
})

/**
 * The value in the line, as the button that opens its editor. Radix hands it
 * the trigger's props and ref (`asChild`), so it spreads whatever it is given.
 */
export function ValueButton({ className, children, ...rest }: ComponentPropsWithRef<'button'>) {
  const styles = propertyEditorStyles()
  return (
    <button type="button" className={styles.trigger({ className })} {...rest}>
      {children}
    </button>
  )
}

/** "Decided on" becomes "decided on", "ADR accepted" stays as it is. */
export function inSentence(label: string): string {
  const [first = '', second = ''] = label
  return second === second.toLowerCase() ? first.toLowerCase() + label.slice(1) : label
}

interface PopoverEditorProps {
  readonly label: string
  readonly trigger: ReactElement
  readonly open: boolean
  onOpenChange(open: boolean): void
}

/* --- One of a few values -------------------------------------------------- */

export function ChoiceEditor({
  label,
  value,
  options,
  trigger,
  open,
  onOpenChange,
  onWrite,
}: PopoverEditorProps & {
  readonly value: string
  readonly options: readonly ChoiceMenuOption[]
  onWrite(value: string): void
}) {
  return (
    <ChoiceMenu
      label={label}
      value={value}
      options={options}
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      onValueChange={(next) => {
        if (next !== value) onWrite(next)
      }}
    />
  )
}

/* --- Text ----------------------------------------------------------------- */

/**
 * A line of text, written when the editor closes or on Enter. The field holds
 * what is being typed; nothing reaches the document until it is finished.
 */
export function TextEditor({
  label,
  value,
  trigger,
  open,
  onOpenChange,
  onWrite,
}: PopoverEditorProps & { readonly value: string; onWrite(value: string): void }) {
  const [text, setText] = useState(value)

  function finish(): void {
    if (text.trim() !== value) onWrite(text)
  }

  return (
    <PropertyPopover
      label={`Edit ${inSentence(label)}`}
      trigger={trigger}
      open={open}
      onOpenChange={(next) => {
        if (next) setText(value)
        else finish()
        onOpenChange(next)
      }}
    >
      {(close) => (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            close()
          }}
        >
          <Input
            label={label}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
            }}
          />
        </form>
      )}
    </PropertyPopover>
  )
}

/* --- A date --------------------------------------------------------------- */

/** Today, as front matter writes a date. */
export function today(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function DateEditor({
  label,
  value,
  now,
  trigger,
  open,
  onOpenChange,
  onWrite,
}: PopoverEditorProps & {
  readonly value: string
  readonly now: Date
  onWrite(value: string | undefined): void
}) {
  const styles = propertyEditorStyles()
  return (
    <PropertyPopover
      label={`Edit ${inSentence(label)}`}
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className={styles.form()}>
        <div className={styles.row()}>
          <Input
            label={label}
            type="date"
            className="flex-1"
            value={value}
            onChange={(event) => {
              onWrite(event.target.value === '' ? undefined : event.target.value)
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onWrite(today(now))
            }}
          >
            Today
          </Button>
        </div>
      </div>
    </PropertyPopover>
  )
}

/* --- The review cycle ----------------------------------------------------- */

const INTERVAL_PRESETS = ['1m', '3m', '6m', '1y'] as const

export interface ReviewValue {
  readonly interval: string
  readonly lastReviewed: string
}

/**
 * How often, and when last. Presets cover what teams actually choose; a
 * custom interval is a count and a unit, said wrong in words beside it rather
 * than written; "Reviewed today" is the action a reviewer takes most.
 */
export function ReviewEditor({
  value,
  now,
  trigger,
  open,
  onOpenChange,
  onWrite,
}: Omit<PopoverEditorProps, 'label'> & {
  readonly value: ReviewValue
  readonly now: Date
  onWrite(next: { readonly interval?: string; readonly lastReviewed?: string }): void
}) {
  const styles = propertyEditorStyles()
  const name = useId()
  const [custom, setCustom] = useState(value.interval)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const preset = INTERVAL_PRESETS.find((candidate) => candidate === value.interval)
  const from = value.lastReviewed === '' ? undefined : new Date(`${value.lastReviewed}T00:00:00Z`)
  const due =
    from === undefined || !isReviewInterval(value.interval)
      ? undefined
      : nextReviewDue(value.interval, from)

  function writeCustom(): void {
    const interval = custom.trim()
    if (interval === value.interval) return
    if (interval !== '' && !isReviewInterval(interval)) {
      setProblem('Use a count and a unit, such as 90d, 6m or 1y.')
      return
    }
    setProblem(undefined)
    onWrite({ interval })
  }

  return (
    <PropertyPopover
      label="Edit review"
      trigger={trigger}
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setCustom(value.interval)
          setProblem(undefined)
        }
        onOpenChange(next)
      }}
    >
      <div className={styles.form()}>
        <fieldset className="flex flex-col gap-2">
          <legend className={styles.heading()}>Review every</legend>
          <div className={styles.presets()}>
            {INTERVAL_PRESETS.map((interval) => (
              <label key={interval} className={styles.preset()}>
                <input
                  type="radio"
                  name={name}
                  className="sr-only"
                  checked={preset === interval}
                  onChange={() => {
                    setCustom(interval)
                    setProblem(undefined)
                    onWrite({ interval })
                  }}
                />
                <span className="flex h-full items-center">{describeInterval(interval)}</span>
              </label>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              writeCustom()
            }}
          >
            <Input
              label="Custom interval"
              description="A count and a unit: 90d, 2w, 6m, 1y."
              value={custom}
              {...(problem === undefined ? {} : { error: problem })}
              onChange={(event) => {
                setCustom(event.target.value)
              }}
              onBlur={writeCustom}
            />
          </form>
        </fieldset>

        <div className={styles.row()}>
          <Input
            label="Last reviewed"
            type="date"
            className="flex-1"
            value={value.lastReviewed}
            max={today(now)}
            onChange={(event) => {
              onWrite({ lastReviewed: event.target.value })
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onWrite({ lastReviewed: today(now) })
            }}
          >
            Reviewed today
          </Button>
        </div>

        {due === undefined ? undefined : (
          <p className={styles.readout()} aria-live="polite">
            Next review due {absoluteDate(due)} ({relativeDate(due, now)})
          </p>
        )}
      </div>
    </PropertyPopover>
  )
}

/* --- People --------------------------------------------------------------- */

const SEARCH_DELAY_MS = 150

interface Answer {
  readonly query: string
  readonly people: readonly Person[]
}

/**
 * Who matches what is being typed, from the directory.
 *
 * The search is the external system this synchronises with: it starts a
 * moment after typing stops and is abandoned when typing starts again, so a
 * slow answer to an old query never replaces a fresh one. Busy is derived —
 * an answer for a query other than this one is no answer yet.
 */
function usePeopleSearch(directory: PeopleDirectory | undefined, query: string) {
  const [answer, setAnswer] = useState<Answer>({ query: '', people: [] })
  const wanted = query.trim()

  // Synchronises with the people directory (the network, through the host's
  // adapter): one search per pause in typing, abandoned when typing resumes.
  useEffect(() => {
    if (directory === undefined || wanted === '') return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      directory.search(wanted, controller.signal).then(
        (people) => {
          if (!controller.signal.aborted) setAnswer({ query: wanted, people })
        },
        () => {
          if (!controller.signal.aborted) setAnswer({ query: wanted, people: [] })
        },
      )
    }, SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [directory, wanted])

  const settled = answer.query === wanted
  return {
    people: wanted === '' ? [] : answer.people,
    busy: directory !== undefined && wanted !== '' && !settled,
  }
}

export function PeopleEditor({
  label,
  values,
  directory,
  trigger,
  open,
  onOpenChange,
  onWrite,
}: PopoverEditorProps & {
  readonly values: readonly string[]
  readonly directory: PeopleDirectory | undefined
  onWrite(values: readonly string[]): void
}) {
  const styles = propertyEditorStyles()
  const [query, setQuery] = useState('')
  const { people, busy } = usePeopleSearch(directory, query)
  const offered = people.filter((person) => !values.includes(person.value))
  const groups: readonly ListboxGroup[] =
    offered.length === 0
      ? []
      : [
          {
            id: 'people',
            label: 'People',
            options: offered.map((person) => ({
              id: person.value,
              label: (
                <span className={styles.person()}>
                  <Avatar name={person.name} />
                  {person.name}
                </span>
              ),
              ...(person.detail === undefined
                ? {}
                : { detail: <span className={styles.personDetail()}>{person.detail}</span> }),
            })),
          },
        ]
  const typed = query.trim()
  const notice =
    typed === '' || busy || offered.length > 0
      ? undefined
      : `No one matches “${typed}”. Press Enter to add it as written.`

  function add(next: readonly string[]): void {
    const fresh = next.filter((value) => !values.includes(value))
    if (fresh.length > 0) onWrite([...values, ...fresh])
    setQuery('')
  }

  return (
    <PropertyPopover
      label={`Edit ${inSentence(label)}`}
      trigger={trigger}
      open={open}
      onOpenChange={(next) => {
        setQuery('')
        onOpenChange(next)
      }}
    >
      <TokenInput
        label={label}
        focusOnMount
        placeholder="Search people"
        tokens={values.map((value) => {
          const name = directory?.nameOf(value) ?? value
          return { id: value, label: name, leading: <Avatar name={name} /> }
        })}
        query={query}
        onQueryChange={setQuery}
        groups={groups}
        busy={busy}
        notice={notice}
        onChoose={(value) => {
          add([value])
        }}
        onEnterText={add}
        onRemove={(value) => {
          onWrite(values.filter((entry) => entry !== value))
        }}
      />
    </PropertyPopover>
  )
}

/* --- Tags ----------------------------------------------------------------- */

const MOST_SUGGESTIONS = 8

export function TagsEditor({
  values,
  suggestions,
  trigger,
  open,
  onOpenChange,
  onWrite,
}: Omit<PopoverEditorProps, 'label'> & {
  readonly values: readonly string[]
  readonly suggestions: readonly string[]
  onWrite(values: readonly string[]): void
}) {
  const [query, setQuery] = useState('')
  const typed = query.trim().toLowerCase()
  const offered = [...new Set(suggestions)]
    .filter((tag) => !values.includes(tag) && tag.toLowerCase().includes(typed))
    .slice(0, MOST_SUGGESTIONS)

  function add(next: readonly string[]): void {
    const fresh = [...new Set(next)].filter((tag) => !values.includes(tag))
    if (fresh.length > 0) onWrite([...values, ...fresh])
    setQuery('')
  }

  return (
    <PropertyPopover
      label="Edit tags"
      trigger={trigger}
      open={open}
      onOpenChange={(next) => {
        setQuery('')
        onOpenChange(next)
      }}
    >
      <TokenInput
        label="Tags"
        focusOnMount
        placeholder="Add a tag"
        description="Enter or a comma adds a tag. Paste a list to add several."
        tokens={values.map((tag) => ({ id: tag, label: tag }))}
        query={query}
        onQueryChange={setQuery}
        groups={
          offered.length === 0
            ? []
            : [
                {
                  id: 'suggested',
                  label: 'Suggested',
                  options: offered.map((tag) => ({ id: tag, label: tag })),
                },
              ]
        }
        onChoose={(tag) => {
          add([tag])
        }}
        onEnterText={add}
        onRemove={(tag) => {
          onWrite(values.filter((entry) => entry !== tag))
        }}
      />
    </PropertyPopover>
  )
}

/* --- The page that replaces a deprecated one ------------------------------ */

/** How long typing rests before the document search is asked, as the link editor waits. */
export const REPLACEMENT_SEARCH_DELAY_MS = 150

export type DocumentSearch = (
  query: string,
  signal: AbortSignal,
) => Promise<readonly DocumentLinkTarget[]>

interface Found {
  readonly query: string
  readonly targets: readonly DocumentLinkTarget[]
}

/**
 * "Replaced by": the page a deprecated one sends its readers to, found by
 * typing its title, with the same document search the link editor uses
 * (`link-popover.tsx`), so a page found in one is found the same way in the
 * other. Written as the document's id (AGENTS.md rule 8); choosing one, or
 * removing it, is one edit.
 */
export function ReplacementEditor({
  current,
  search,
  excludeId,
  trigger,
  open,
  onOpenChange,
  onWrite,
}: Omit<PopoverEditorProps, 'label'> & {
  /** The replacement chosen now, by its title when the host could name it. */
  readonly current: { readonly id: string; readonly title: string | undefined } | undefined
  readonly search: DocumentSearch | undefined
  /** The document being edited, which cannot replace itself. */
  readonly excludeId?: string | undefined
  onWrite(id: string | undefined): void
}) {
  const styles = propertyEditorStyles()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Found>({ query: '', targets: [] })
  const wanted = query.trim()
  const searchable = search !== undefined && wanted !== ''
  const answered = searchable && found.query === wanted
  const targets = answered
    ? found.targets.filter((target) => target.id !== excludeId && target.id !== current?.id)
    : []

  // Asks the application's search, an external system, once typing rests,
  // abandoning an answer the next keystroke has made stale.
  useEffect(() => {
    if (search === undefined || wanted === '') return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const settle = (answer: readonly DocumentLinkTarget[]): void => {
        if (!controller.signal.aborted) setFound({ query: wanted, targets: answer })
      }
      search(wanted, controller.signal).then(settle, () => {
        settle([])
      })
    }, REPLACEMENT_SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [search, wanted])

  const groups: ListboxGroup[] =
    targets.length === 0
      ? []
      : [
          {
            id: 'documents',
            label: 'Documents',
            options: targets.map((target) => ({
              id: target.id,
              label: target.title,
              ...(target.context === undefined ? {} : { detail: target.context }),
            })),
          },
        ]

  return (
    <PropertyPopover
      label="Edit replacement"
      trigger={trigger}
      open={open}
      onOpenChange={(next) => {
        if (next) setQuery('')
        onOpenChange(next)
      }}
    >
      {(close) => (
        <div className={styles.form()}>
          {current === undefined ? undefined : (
            <div className={styles.actions()}>
              <span className="min-w-0 text-xs text-muted">
                Replaced by{' '}
                <span className="font-medium text-foreground">
                  {current.title ?? 'a page you cannot open'}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onWrite(undefined)
                  close()
                }}
              >
                Remove
              </Button>
            </div>
          )}
          {search === undefined ? (
            <p className={styles.readout()}>Finding pages is not available here.</p>
          ) : (
            <Combobox
              label={current === undefined ? 'Replaced by' : 'Replace with another page'}
              placeholder="Find the page that replaces this one"
              value={query}
              onValueChange={setQuery}
              groups={groups}
              busy={searchable && !answered}
              {...(answered && targets.length === 0 ? { notice: 'Nothing matches' } : {})}
              {...(targets.length === 0 ? {} : { status: `${String(targets.length)} documents` })}
              onSelect={(id) => {
                onWrite(id)
                close()
              }}
            />
          )}
        </div>
      )}
    </PropertyPopover>
  )
}
