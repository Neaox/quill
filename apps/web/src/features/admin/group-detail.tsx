import { Link } from '@tanstack/react-router'
import { useId } from 'react'

import { Button, Callout, ChevronRightIcon, Menu, Spinner, tv } from '@quill/ui'

import { useGroupMembers, useRemoveGroupMember, type GroupSummaryDto } from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { GroupMemberPicker } from './group-member-picker.tsx'

export const groupDetailStyles = tv({
  slots: {
    root: 'flex min-w-0 flex-col gap-6',
    back: [
      'focus-ring inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted',
      'hover:text-foreground md:hidden',
    ],
    backIcon: 'size-3.5 rotate-180',
    header: 'flex items-start justify-between gap-3',
    title: 'min-w-0 truncate text-lg font-semibold tracking-tight text-foreground',
    meta: 'mt-0.5 text-xs text-muted',
    members: 'flex flex-col gap-2',
    heading: 'text-sm font-medium text-foreground',
    list: 'flex flex-col divide-y divide-border rounded-md border border-border',
    person: 'flex items-center gap-3 px-3 py-2',
    personText: 'flex min-w-0 grow flex-col',
    personName: 'truncate text-sm font-medium text-foreground',
    personEmail: 'truncate text-xs text-muted',
    empty: 'rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted',
    busy: 'flex items-center gap-2 text-sm text-muted',
  },
})

export interface GroupDetailProps {
  readonly group: GroupSummaryDto
  readonly onRename: () => void
  readonly onDelete: () => void
  readonly onNewNested: () => void
}

/**
 * One group: its name and where it sits, the way to add people, and who is in
 * it with a way to take each one out.
 *
 * Removing somebody acts at once, with no confirmation: it is undone by adding
 * them again from the search above, and a dialog for every removal would be
 * the slow part of the job. Deleting the group is the step that asks.
 */
export function GroupDetail({ group, onRename, onDelete, onNewNested }: GroupDetailProps) {
  const styles = groupDetailStyles()
  const headingId = useId()
  const members = useGroupMembers(group.id)
  const remove = useRemoveGroupMember()
  const people = members.data ?? []
  const memberIds = new Set(people.map((person) => person.id))

  return (
    <section aria-labelledby={headingId} className={styles.root()}>
      <Link to="/admin/groups" search={{}} className={styles.back()}>
        <ChevronRightIcon className={styles.backIcon()} aria-hidden="true" />
        All groups
      </Link>

      <header className={styles.header()}>
        <div className="min-w-0">
          <h2 id={headingId} className={styles.title()}>
            {group.name}
          </h2>
          <p className={styles.meta()}>
            {group.unitPath} · {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </p>
        </div>
        <Menu
          label={group.name}
          align="end"
          items={[
            { label: 'Rename…', onSelect: onRename },
            { label: 'New group inside…', onSelect: onNewNested },
            { label: 'Delete…', onSelect: onDelete },
          ]}
        />
      </header>

      <GroupMemberPicker groupId={group.id} memberIds={memberIds} />

      <div className={styles.members()}>
        <h3 className={styles.heading()}>Members</h3>
        {members.isPending ? (
          <p aria-busy="true" className={styles.busy()}>
            <Spinner /> Loading members
          </p>
        ) : members.isError ? (
          <Callout tone="danger" title="Couldn't load the members">
            Reload the page to try again.
          </Callout>
        ) : people.length === 0 ? (
          <p className={styles.empty()}>
            Nobody is in this group yet. Search above to add the first person.
          </p>
        ) : (
          <ul aria-label={`Members of ${group.name}`} className={styles.list()}>
            {people.map((person) => (
              <li key={person.id} className={styles.person()}>
                <span className={styles.personText()}>
                  <span className={styles.personName()}>{person.name}</span>
                  <span className={styles.personEmail()}>{person.email}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${person.name} from ${group.name}`}
                  loading={remove.isPending && remove.variables.userId === person.id}
                  onClick={() => {
                    remove.mutate({ groupId: group.id, userId: person.id })
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <FormError error={remove.error} />
      </div>
    </section>
  )
}
