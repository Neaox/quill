import { useState } from 'react'

import { Combobox, type ListboxGroup } from '@quill/ui'

import { useAddGroupMember, usePeopleSearch } from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { useDebouncedValue } from '../search/use-debounced-value.ts'

export interface GroupMemberPickerProps {
  readonly groupId: string
  /** Who is in the group already, so they are not offered again. */
  readonly memberIds: ReadonlySet<string>
}

/**
 * Add somebody to a group by searching for them: a name or an address
 * beginning with what was typed. Choosing a person adds them at once and
 * clears the field, so several people are added one after another without
 * leaving it.
 *
 * Left empty, the search lists the first people alphabetically, which is a
 * browsable list for a small organisation and costs nothing for a large one:
 * the server never returns more than twenty.
 */
export function GroupMemberPicker({ groupId, memberIds }: GroupMemberPickerProps) {
  const [query, setQuery] = useState('')
  const settled = useDebouncedValue(query.trim(), 200)
  const people = usePeopleSearch(settled)
  const add = useAddGroupMember()

  const candidates = (people.data ?? []).filter((person) => !memberIds.has(person.id))
  const groups: ListboxGroup[] =
    candidates.length === 0
      ? []
      : [
          {
            id: 'people',
            label: 'People',
            options: candidates.map((person) => ({
              id: person.id,
              label: person.name,
              detail: person.email,
            })),
          },
        ]

  const searching = people.isPending || settled !== query.trim()

  function choose(userId: string) {
    add.mutate(
      { groupId, userId },
      {
        onSuccess: () => {
          setQuery('')
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Combobox
        label="Add people"
        description="Search by name or email address."
        placeholder="Name or email"
        value={query}
        onValueChange={(next) => {
          add.reset()
          setQuery(next)
        }}
        groups={groups}
        onSelect={choose}
        busy={searching || add.isPending}
        notice={
          searching
            ? 'Searching…'
            : people.isError
              ? 'The search failed. Try again.'
              : candidates.length === 0
                ? settled === ''
                  ? 'Everyone is already in this group.'
                  : `Nobody new matches “${settled}”.`
                : undefined
        }
        status={
          searching
            ? undefined
            : `${String(candidates.length)} ${candidates.length === 1 ? 'person' : 'people'} found`
        }
      />
      <FormError error={add.error} />
    </div>
  )
}
