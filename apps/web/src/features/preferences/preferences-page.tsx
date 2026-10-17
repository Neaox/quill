import { useId } from 'react'

import { Button, Spinner, toast, tv } from '@quill/ui'

import {
  useClearViewingHistory,
  usePersonPreferences,
  useSavePersonPreferences,
} from '../../lib/api/index.ts'
import type { PersonPreferences } from '../../lib/api/index.ts'
import { AppPage } from '../layout/app-page.tsx'
import { SegmentedControl, type Segment } from '../theme/segmented-control.tsx'

type AnimatedImages = PersonPreferences['animatedImages']

/** In the order of how much an image moves: the default first. */
export const ANIMATED_IMAGE_CHOICES: readonly Segment<AnimatedImages>[] = [
  { value: 'brief', label: 'Play briefly' },
  { value: 'hover', label: 'Play on hover only' },
  { value: 'never', label: 'Never' },
]

const preferencesPageStyles = tv({
  slots: {
    title: 'text-2xl font-semibold tracking-tight text-foreground',
    lede: 'mt-1 text-sm text-muted',
    section: 'flex flex-col gap-3',
    heading: 'text-sm font-semibold text-foreground',
    description: 'text-sm text-muted',
    // A fixed height, so the line appearing and changing moves nothing.
    status: 'flex h-5 items-center gap-2 text-xs text-muted',
  },
})

/**
 * The person's own preferences: what follows them to every device they sign
 * in on, as against the colour scheme in the person menu, which belongs to
 * this browser (ADR-028, layer 3). The first is how animated images play
 * (ADR-047).
 *
 * A choice saves as it is made; there is no Save button for one radio group.
 * The control shows the choice at once, the line beside it says the save is
 * under way and then that it is done (`docs/design/feedback.md`, inline
 * status), and a refused save is a toast that says so while the control
 * returns to what is stored.
 */
export function PreferencesPage() {
  const preferences = usePersonPreferences()
  const save = useSavePersonPreferences()
  const clearHistory = useClearViewingHistory()
  const historyId = useId()
  const styles = preferencesPageStyles()
  const headingId = useId()
  const descriptionId = useId()

  const stored = preferences.data
  const shown = save.isPending ? save.variables.animatedImages : stored?.animatedImages

  return (
    <AppPage>
      <div>
        <h1 className={styles.title()}>Preferences</h1>
        <p className={styles.lede()}>Yours alone, and the same on every device you sign in on.</p>
      </div>

      <section aria-labelledby={headingId} className={styles.section()}>
        <h2 id={headingId} className={styles.heading()}>
          Animated images
        </h2>
        <p id={descriptionId} className={styles.description()}>
          How moving pictures play in documents. If your system asks for reduced motion, you always
          see a still image.
        </p>
        {stored === undefined ? (
          <p aria-busy="true" className={styles.status()}>
            {preferences.isError ? (
              'Couldn’t load your preferences. Reload the page to try again.'
            ) : (
              <>
                <Spinner /> Loading your preferences
              </>
            )}
          </p>
        ) : (
          <>
            <SegmentedControl
              legend="Animated images"
              describedBy={descriptionId}
              segments={ANIMATED_IMAGE_CHOICES}
              value={shown}
              className="self-start"
              onValueChange={(animatedImages) => {
                save.mutate(
                  { ...stored, animatedImages },
                  {
                    onError: () => {
                      toast.danger('Your preference wasn’t saved', {
                        description: 'Nothing changed. Choose again to retry.',
                      })
                    },
                  },
                )
              }}
            />
            <p role="status" className={styles.status()}>
              {save.isPending ? (
                <>
                  <Spinner /> Saving
                </>
              ) : save.isSuccess ? (
                'Saved'
              ) : undefined}
            </p>
          </>
        )}
      </section>

      <section aria-labelledby={historyId} className={styles.section()}>
        <h2 id={historyId} className={styles.heading()}>
          Viewing history
        </h2>
        <p className={styles.description()}>
          Quill remembers which documents you open, for you alone, so your home page can take you
          back to them and put the workspaces you use first. Nobody else sees it, administrators
          included. It is kept for 90 days.
        </p>
        <div>
          <Button
            variant="secondary"
            size="sm"
            loading={clearHistory.isPending}
            onClick={() => {
              clearHistory.mutate(undefined, {
                onSuccess: () => {
                  toast.success('Viewing history cleared')
                },
                onError: () => {
                  toast.danger('Your history wasn’t cleared', { description: 'Try again.' })
                },
              })
            }}
          >
            Clear viewing history
          </Button>
        </div>
      </section>
    </AppPage>
  )
}
