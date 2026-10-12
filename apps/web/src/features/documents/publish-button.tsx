import { useState } from 'react'

import { Button, Dialog, DialogClose } from '@quill/ui'

import { counted } from '../../lib/text/plural.ts'
import { DraftChangesCard } from './draft-changes-card.tsx'
import type { OtherAuthor } from './publish-changes.ts'
import { useDraftChanges, type DraftChangesOptions } from './use-draft-changes.ts'

export interface PublishButtonProps extends DraftChangesOptions {
  readonly loading: boolean
  /** The draft cannot be published at all (no lock, or a conflict). */
  readonly blocked: boolean
  readonly onPublish: () => void
  /** Opens the review of what is waiting, from its panel. */
  readonly onReview?: ((change?: string) => void) | undefined
}

/**
 * Publish, and what it would publish.
 *
 * A writer who has changed nothing has nothing to publish, and one who has wants to know
 * how much before it goes: the button says there is nothing when there is nothing, and its
 * panel says what is waiting (`useDraftChanges`).
 *
 * Changes another person made go out with a publish too, and the writer may not know they
 * are there: when there are any, Publish asks first, naming who and how many, and offers
 * the review. A draft whose authors are not known (one with no record) never asks.
 *
 * "Nothing to publish" is `aria-disabled`, not `disabled`: the button stays where it is
 * and can be focused, which is how its reason is reached. Not knowing yet, or failing to
 * find out, never stops a publish.
 */
export function PublishButton({
  loading,
  blocked,
  onPublish,
  onReview,
  ...draft
}: PublishButtonProps) {
  const changes = useDraftChanges(draft)
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <DraftChangesCard
        changes={changes}
        title="Changes to publish"
        whenNone="No changes since this was last published."
        whenUnknown="Couldn’t check what has changed. You can still publish."
        {...(onReview === undefined ? {} : { onReview })}
      >
        <Button
          size="sm"
          loading={loading}
          disabled={blocked}
          aria-disabled={changes.nothing || undefined}
          aria-describedby={changes.descriptionId}
          className="aria-disabled:cursor-default aria-disabled:opacity-50"
          onClick={() => {
            if (changes.nothing) return
            if (changes.others.length > 0) setConfirming(true)
            else onPublish()
          }}
        >
          Publish
        </Button>
      </DraftChangesCard>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Publish changes made by others?"
        description={<WhoElse others={changes.others} />}
        footer={
          <>
            <DialogClose>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            {onReview === undefined ? undefined : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConfirming(false)
                  onReview()
                }}
              >
                Review changes
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                setConfirming(false)
                onPublish()
              }}
            >
              Publish anyway
            </Button>
          </>
        }
      >
        <p>Publishing sends everything in the draft, not only what you changed.</p>
      </Dialog>
    </>
  )
}

const CHANGE = { one: 'change', other: 'changes' }

/** Who else wrote what is about to go out, and how much each. */
function WhoElse({ others }: { readonly others: readonly OtherAuthor[] }) {
  return (
    <>
      The draft includes{' '}
      {others.map(({ name, changes }) => `${counted(changes, CHANGE)} by ${name}`).join(', ')}.
    </>
  )
}
