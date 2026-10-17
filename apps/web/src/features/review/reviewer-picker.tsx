import { useState } from 'react'

import { Combobox, CloseIcon, UserIcon, UsersIcon, tv, type ListboxGroup } from '@quill/ui'

import { useReviewerCandidates } from '../../lib/api/index.ts'
import { useDebouncedValue } from '../search/use-debounced-value.ts'

/** The most people and groups one request can name (ADR-052). */
export const MAX_REVIEWERS = 20

/** Somebody chosen to review, with what is needed to show them without asking again. */
export interface ChosenReviewer {
  readonly kind: 'user' | 'group'
  readonly id: string
  readonly name: string
  /** An address for a person, a size for a group. */
  readonly detail: string
}

export const reviewerPickerStyles = tv({
  slots: {
    root: 'flex flex-col gap-2.5',
    chips: 'flex flex-wrap gap-1.5',
    chip: [
      'inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border border-border',
      'bg-surface ps-2 pe-1 text-xs text-foreground',
    ],
    chipIcon: 'size-3.5 shrink-0 text-muted',
    chipName: 'truncate font-medium',
    chipKind: 'text-2xs text-muted',
    remove: [
      'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted',
      'transition-colors ease-standard hover:bg-border hover:text-foreground',
      'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus-ring',
    ],
    full: 'text-2xs text-muted',
  },
})

const peopleCount = (count: number) => `${String(count)} ${count === 1 ? 'person' : 'people'}`

export interface ReviewerPickerProps {
  readonly documentId: string
  readonly chosen: readonly ChosenReviewer[]
  readonly onChange: (chosen: readonly ChosenReviewer[]) => void
}

/**
 * Who to ask, as people and groups together: a search over the ones who can see this
 * document (the server never offers anybody else), and the chosen ones as removable chips.
 *
 * A group is one choice, answered by any one of its members, which the chip says; the
 * search is for names, so a team and the people in it are found the same way.
 */
export function ReviewerPicker({ documentId, chosen, onChange }: ReviewerPickerProps) {
  const styles = reviewerPickerStyles()
  const [query, setQuery] = useState('')
  const settled = useDebouncedValue(query.trim(), 200)
  const candidates = useReviewerCandidates(documentId, settled)
  const full = chosen.length >= MAX_REVIEWERS

  const isChosen = (kind: string, id: string) =>
    chosen.some((reviewer) => reviewer.kind === kind && reviewer.id === id)

  const people = (candidates.data?.people ?? []).filter(
    (person) => person.canView && !isChosen('user', person.id),
  )
  const teams = (candidates.data?.groups ?? []).filter(
    (group) => group.canView && !isChosen('group', group.id),
  )
  const groups: ListboxGroup[] = [
    {
      id: 'groups',
      label: 'Groups',
      options: teams.map((group) => ({
        id: `group:${group.id}`,
        label: group.name,
        detail: `Any one of ${peopleCount(group.memberCount)} can answer`,
      })),
    },
    {
      id: 'people',
      label: 'People',
      options: people.map((person) => ({
        id: `user:${person.id}`,
        label: person.name,
        detail: person.email,
      })),
    },
  ].filter((group) => group.options.length > 0)

  const searching = candidates.isPending || settled !== query.trim()
  const total = people.length + teams.length

  function choose(optionId: string) {
    if (full) return
    const [kind, id] = optionId.split(':')
    if (kind === 'user') {
      const person = people.find((entry) => entry.id === id)
      if (person !== undefined) {
        onChange([
          ...chosen,
          { kind: 'user', id: person.id, name: person.name, detail: person.email },
        ])
      }
    } else if (kind === 'group') {
      const group = teams.find((entry) => entry.id === id)
      if (group !== undefined) {
        onChange([
          ...chosen,
          { kind: 'group', id: group.id, name: group.name, detail: peopleCount(group.memberCount) },
        ])
      }
    }
    setQuery('')
  }

  return (
    <div className={styles.root()}>
      <Combobox
        label="Reviewers"
        variant="flow"
        description={
          full
            ? `You can ask up to ${String(MAX_REVIEWERS)} people and groups.`
            : 'Search for a person or a group. Only people who can see this document are listed.'
        }
        placeholder="Name a person or a group"
        value={query}
        onValueChange={setQuery}
        groups={groups}
        onSelect={choose}
        busy={searching}
        notice={
          searching
            ? 'Searching…'
            : total === 0
              ? settled === ''
                ? 'No one else can review this yet.'
                : `No one matches “${settled}”.`
              : undefined
        }
        status={searching ? undefined : `${String(total)} ${total === 1 ? 'result' : 'results'}`}
      />

      {chosen.length === 0 ? undefined : (
        <ul aria-label="Chosen reviewers" className={styles.chips()}>
          {chosen.map((reviewer) => (
            <li key={`${reviewer.kind}:${reviewer.id}`} className={styles.chip()}>
              {reviewer.kind === 'group' ? (
                <UsersIcon className={styles.chipIcon()} />
              ) : (
                <UserIcon className={styles.chipIcon()} />
              )}
              <span className={styles.chipName()}>{reviewer.name}</span>
              {reviewer.kind === 'group' ? (
                <span className={styles.chipKind()}>group · {reviewer.detail}</span>
              ) : undefined}
              <button
                type="button"
                className={styles.remove()}
                aria-label={`Remove ${reviewer.name}`}
                onClick={() => {
                  onChange(
                    chosen.filter(
                      (entry) => entry.kind !== reviewer.kind || entry.id !== reviewer.id,
                    ),
                  )
                }}
              >
                <CloseIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
