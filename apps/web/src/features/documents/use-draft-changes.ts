import { useId } from 'react'

import { DRAFT_SIDE, useComparison } from '../../lib/api/content.ts'
import { useSettled } from '../../lib/time/use-settled.ts'
import { useMe } from '../../lib/api/auth.ts'
import {
  describeChanges,
  othersChanges,
  type DescribedChanges,
  type OtherAuthor,
} from './publish-changes.ts'

/** How long the draft rests before what it says is asked about again. */
const SETTLE_MS = 1200

export const STILL_SAVING = 'Your latest edits are still being saved.'

export interface DraftChangesOptions {
  readonly documentId: string
  /** The revision on the page now, which is what the draft is measured against. */
  readonly published: string | null
  /** The version of the draft last saved. */
  readonly saved: number
  /** Whether an edit has not reached the server yet. */
  readonly unsaved: boolean
}

export interface DraftChanges {
  /** What differs, once it is known; the last answer while a newer one is on its way. */
  readonly described: DescribedChanges | undefined
  /** How many changes are waiting, the properties among them, as last known. */
  readonly total: number
  /** The draft, as it is now and fully saved, has nothing that is not published. */
  readonly nothing: boolean
  readonly unsaved: boolean
  /** The other people whose changes are waiting too, which a publish would send out with the writer's own. */
  readonly others: readonly OtherAuthor[]
  /** The comparison could not be had. */
  readonly failed: boolean
  /** What is waiting, as a sentence, for whoever cannot see a panel. Empty when there is none, or it is not known. */
  readonly description: string
  /** The id of the element that carries `description`. */
  readonly descriptionId: string
}

/**
 * What is waiting in the draft that the published page does not say.
 *
 * The comparison of the saved draft with the page as published, asked about when the
 * writer pauses rather than at every save. Publish and the draft preview both want it,
 * and ask for the same comparison, so it is fetched once.
 *
 * "Nothing" is only claimed of the draft as it now is: an answer about an older save, or
 * with edits still on their way to the server, can say what was waiting but never that
 * nothing is.
 */
export function useDraftChanges({
  documentId,
  published,
  saved,
  unsaved,
}: DraftChangesOptions): DraftChanges {
  const descriptionId = useId()
  const me = useMe().data
  const settled = useSettled(saved, SETTLE_MS)
  const comparison = useComparison(
    documentId,
    { from: published, to: DRAFT_SIDE },
    { version: settled },
  )
  const described = comparison.data === undefined ? undefined : describeChanges(comparison.data)
  const current =
    comparison.data !== undefined && !comparison.isPlaceholderData && settled === saved && !unsaved
  const nothing = current && described?.empty === true

  const waiting = described?.empty === false ? described.text : undefined
  const description = [waiting, unsaved ? STILL_SAVING : undefined]
    .filter((part) => part !== undefined)
    .join(' ')

  const others =
    comparison.data === undefined || me === undefined ? [] : othersChanges(comparison.data, me.id)

  return {
    described,
    total: described === undefined ? 0 : described.items.length + described.more,
    nothing,
    others,
    unsaved,
    failed: comparison.isError,
    description,
    descriptionId,
  }
}
