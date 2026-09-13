import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'

import { Button, Callout, Dialog } from '@quill/ui'

import {
  readUnreadableRevision,
  useSaveOrganisationSettings,
  isSettingsUnreadable,
} from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { defaultOrganisationSettings } from './settings-defaults.ts'

export interface SettingsRouteErrorProps {
  readonly error: unknown
}

/**
 * What a settings route shows when it could not load.
 *
 * The interesting case is `500 settings_unreadable`: a settings file written
 * by a **newer** release, which this one refuses to read, refuses to
 * overwrite, and refuses to replace with the defaults on its own, because
 * overwriting an administrator's configuration is the most expensive way to
 * recover from a downgrade (ADR-034). The response carries one thing, and
 * only to an instance administrator: the file's revision. That revision is
 * the `expectedRevision` of the `PUT` that overwrites it, which is what makes
 * the repair an API action rather than an edit to a repository by hand.
 *
 * So this screen offers exactly that repair, behind a dialog that says what
 * will be written and what will be lost, and says so only to somebody who was
 * given the revision. Everyone else gets the sentence and no control, because
 * a control that is certain to be refused is a control that swallows a press
 * (`docs/design/feedback.md`).
 */
export function SettingsRouteError({ error }: SettingsRouteErrorProps) {
  if (isSettingsUnreadable(error)) {
    return <UnreadableSettings revision={readUnreadableRevision(error)} />
  }

  return (
    <Callout tone="danger" title="Couldn't load these settings">
      Something went wrong on the way. Reload the page to try again; if it keeps happening, the
      server log will say why.
    </Callout>
  )
}

interface UnreadableSettingsProps {
  /** Present only for an instance administrator: the revision to repair at. */
  readonly revision: string | undefined
}

function UnreadableSettings({ revision }: UnreadableSettingsProps) {
  const router = useRouter()
  const save = useSaveOrganisationSettings()
  const [confirming, setConfirming] = useState(false)

  function repair() {
    if (revision === undefined) return
    save.mutate(
      { settings: defaultOrganisationSettings(), expectedRevision: revision },
      {
        onSuccess: () => {
          setConfirming(false)
          void router.invalidate()
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="danger" title="This instance cannot read its own settings file">
        <p>
          The file was written by a newer release than this one. Nothing has been changed and
          nothing has been lost: this release will not overwrite a configuration it does not
          understand.
        </p>
        {revision === undefined ? (
          <p>Ask an instance administrator to repair it, or run the newer release again.</p>
        ) : (
          <>
            <p>
              You can overwrite it with the settings this release ships with, at revision{' '}
              <code>{revision}</code>, and configure it again from there. Running the newer release
              again keeps what is in the file instead.
            </p>
            <p>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setConfirming(true)
                }}
              >
                Replace with the default settings
              </Button>
            </p>
          </>
        )}
      </Callout>

      {revision === undefined ? undefined : (
        <Dialog
          title="Replace the settings file?"
          description="The file that cannot be read is overwritten with the settings this release ships with."
          open={confirming}
          onOpenChange={(open) => {
            if (!open) setConfirming(false)
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirming(false)
                }}
              >
                Cancel
              </Button>
              <Button variant="danger" loading={save.isPending} onClick={repair}>
                Replace
              </Button>
            </>
          }
        >
          <p>
            The organisation name, theme, layout default, public navigation and policies in that
            file are replaced by the defaults. The file keeps its history, so the revision being
            overwritten — <code>{revision}</code> — can still be read and restored.
          </p>
          <FormError error={save.error} />
        </Dialog>
      )}
    </div>
  )
}
