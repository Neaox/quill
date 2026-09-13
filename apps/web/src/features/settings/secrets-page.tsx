import { useState } from 'react'

import { Badge, Button, Callout, DataTable, Dialog, Input, Spinner } from '@quill/ui'

import {
  useDeleteSecret,
  useOidcProviders,
  useSecrets,
  useSetSecret,
  type SecretDto,
} from '../../lib/api/index.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { ConfirmDeleteDialog } from '../dialogs/confirm-delete-dialog.tsx'
import { SettingsActions, SettingsSection } from './settings-frame.tsx'

/**
 * Secrets, and the sign-in providers that consume them (ADR-034, ADR-011).
 *
 * The single rule this screen is built around: **a value is never shown,
 * because a value is never sent.** `Secret` has no field for one, no route
 * answers with one, and a secret is decrypted only at the moment of use,
 * inside the server. So every field here is write-only and every row is
 * metadata: the name a settings file refers to it by, the key id its data key
 * is wrapped under, and three dates that answer three different questions —
 * when it was first stored, when an administrator last replaced the value,
 * and when a master-key rotation last re-wrapped it.
 *
 * Master-key rotation is deliberately not a button. It is tied to an
 * environment change, on an instance just restarted with a key it did not
 * have before, so it is a command an operator runs; the note below points at
 * it rather than pretending the web app can do it.
 *
 * Sign-in providers are read-only for the same kind of reason: they are
 * configured in the environment (ADR-011's presets), so the product lists
 * what is configured and names the variables that change it, instead of
 * offering an editor for something it does not own.
 */
export function SecretsPage() {
  const secrets = useSecrets()
  const [editing, setEditing] = useState<{ readonly name: string; readonly existing: boolean }>()
  const [deleting, setDeleting] = useState<string>()

  const rows = secrets.data ?? []

  return (
    <>
      <SettingsActions>
        <Button
          size="sm"
          onClick={() => {
            setEditing({ name: '', existing: false })
          }}
        >
          Add a secret
        </Button>
      </SettingsActions>

      <SettingsSection
        title="Secrets"
        description="Values the product needs and must never show again: client secrets, mail passwords, signing keys. Settings files refer to them by name only, which is what makes a settings file safe to copy to another instance."
        wide
      >
        {secrets.isPending ? (
          <p aria-busy="true" className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading the secrets
          </p>
        ) : secrets.isError ? (
          <Callout tone="danger" title="Couldn't load the secrets">
            Reload the page to try again.
          </Callout>
        ) : rows.length === 0 ? (
          <Callout className="max-w-(--layout-content)" tone="info" title="No secrets stored yet">
            A secret is added when something needs one — an identity provider’s client secret, for
            example, referred to from the settings file as <code>oidc/entra/client-secret</code>.
          </Callout>
        ) : (
          <DataTable label="Secrets" caption="Every secret’s name and key id. Never a value.">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Key</th>
                <th scope="col">Stored</th>
                <th scope="col">Replaced</th>
                <th scope="col">Re-wrapped</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((secret) => (
                <SecretRow
                  key={secret.name}
                  secret={secret}
                  onReplace={() => {
                    setEditing({ name: secret.name, existing: true })
                  }}
                  onDelete={() => {
                    setDeleting(secret.name)
                  }}
                />
              ))}
            </tbody>
          </DataTable>
        )}

        <Callout
          className="max-w-(--layout-content)"
          tone="info"
          title="The two commands beside this screen"
        >
          <p>
            Replacing a <em>value</em> is this screen — but a secret needed before anybody can sign
            in to reach it, such as an identity provider’s own client secret, has to be entered from
            a shell. That command reads the value from stdin, never from the command line, so it
            never reaches shell history or a process listing:
          </p>
          <p>
            <code>
              pnpm --filter @quill/server secrets:set &lt;name&gt; &lt; /path/to/secret-file
            </code>
          </p>
          <p>
            Rotating the instance’s <em>master key</em> is the other one. It re-wraps every secret’s
            data key under a new key, and is an operator’s action on an instance restarted with a
            key it did not have before, so it is a command rather than a control:
          </p>
          <p>
            <code>pnpm --filter @quill/server secrets:rotate</code>
          </p>
          <p>The Re-wrapped column is when that last happened to each secret.</p>
        </Callout>
      </SettingsSection>

      <SignInProviders />

      {editing === undefined ? undefined : (
        <SecretDialog
          name={editing.name}
          existing={editing.existing}
          onClose={() => {
            setEditing(undefined)
          }}
        />
      )}

      {deleting === undefined ? undefined : (
        <DeleteSecretDialog
          name={deleting}
          onClose={() => {
            setDeleting(undefined)
          }}
        />
      )}
    </>
  )
}

interface SecretRowProps {
  readonly secret: SecretDto
  readonly onReplace: () => void
  readonly onDelete: () => void
}

function SecretRow({ secret, onReplace, onDelete }: SecretRowProps) {
  return (
    <tr>
      <th scope="row">
        <code>{secret.name}</code>
      </th>
      <td>
        <code>{secret.keyId}</code>
      </td>
      <td>
        <SecretDate value={secret.createdAt} />
      </td>
      <td>
        <SecretDate value={secret.rotatedAt} />
      </td>
      <td>
        <SecretDate value={secret.rewrappedAt} />
      </td>
      <td>
        <span className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Replace the value of ${secret.name}`}
            onClick={onReplace}
          >
            Replace
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Delete ${secret.name}`} onClick={onDelete}>
            Delete
          </Button>
        </span>
      </td>
    </tr>
  )
}

/** A date as a `time` element, or an em dash when the thing never happened. */
function SecretDate({ value }: { readonly value: string | null }) {
  if (value === null) return <span className="text-muted">—</span>
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })}
    </time>
  )
}

interface SecretDialogProps {
  readonly name: string
  readonly existing: boolean
  readonly onClose: () => void
}

/**
 * Storing or replacing a value.
 *
 * The value field is `type="password"` with autocomplete off, and it is never
 * populated: there is nothing to populate it from, which is the point. A
 * replacement is a new value typed in full, and the dialog says what the row
 * will show afterwards so nobody waits for a confirmation that quotes it back.
 */
/** Ties the footer's submit button to the form the dialog renders as its body. */
const SECRET_FORM_ID = 'secret-value-form'

function SecretDialog({ name, existing, onClose }: SecretDialogProps) {
  const setSecret = useSetSecret()
  const [secretName, setSecretName] = useState(name)
  const [value, setValue] = useState('')

  const ready = secretName.trim() !== '' && value !== ''

  /**
   * Drops the value from React state *and* from the mutation, whose
   * `variables` would otherwise hold the plaintext until it is garbage
   * collected. `gcTime: 0` already makes that window as short as the request;
   * this closes it for a dialog cancelled before a request was ever made.
   */
  function close() {
    setValue('')
    setSecret.reset()
    onClose()
  }

  function submit() {
    if (!ready || setSecret.isPending) return
    setSecret.mutate({ name: secretName.trim(), value }, { onSuccess: close })
  }

  return (
    <Dialog
      open
      title={existing ? `Replace ${name}` : 'Add a secret'}
      description={
        existing
          ? 'The old value is replaced. It is not shown here, and it cannot be recovered afterwards.'
          : 'Stored encrypted under this instance’s master key, and referred to from settings files by name.'
      }
      onOpenChange={(open) => {
        if (!open) close()
      }}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={SECRET_FORM_ID}
            loading={setSecret.isPending}
            disabled={!ready}
          >
            {existing ? 'Replace' : 'Store'}
          </Button>
        </>
      }
    >
      {/*
       * A real form, so Enter in either field submits it — which is what
       * anybody typing a secret into a two-field dialog expects, and what a
       * pair of click handlers does not give them. The footer's button is
       * associated by `form`, because the dialog primitive renders the footer
       * outside this element.
       */}
      <form
        id={SECRET_FORM_ID}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Input
          label="Name"
          value={secretName}
          readOnly={existing}
          description="Lower-case and path-like, such as oidc/entra/client-secret."
          onChange={(event) => {
            setSecretName(event.target.value)
          }}
        />
        <Input
          label="Value"
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          description="Write-only. Once stored, nothing in the product will show it again."
          onChange={(event) => {
            setValue(event.target.value)
          }}
        />
        {ready ? undefined : (
          <p className="text-xs text-muted">A name and a value are both needed.</p>
        )}
        <FormError error={setSecret.error} />
      </form>
    </Dialog>
  )
}

/**
 * Deleting a secret, through the dialog collections, units and workspaces
 * already use.
 *
 * `ConfirmDeleteDialog` owns exactly this shape — the name in the title, the
 * rule stated before the button is offered, a danger footer and the
 * submission error — and its `obstacle` is optional, which is what makes it
 * right for a thing that has no emptiness to check. A secret is never
 * "not empty": it is one row, and the cost of removing it is that whatever
 * uses the name stops working, which is what the description says.
 */
function DeleteSecretDialog({
  name,
  onClose,
}: {
  readonly name: string
  readonly onClose: () => void
}) {
  const deleteSecret = useDeleteSecret()

  return (
    <ConfirmDeleteDialog
      open
      name={name}
      description="The row is removed and the value is gone. Anything configured to use this name will stop working."
      isPending={deleteSecret.isPending}
      error={deleteSecret.error}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onConfirm={() => {
        deleteSecret.mutate(name, { onSuccess: onClose })
      }}
    >
      <p>
        A value cannot be recovered once it is deleted: it is encrypted, and nothing in the product
        can read it back. Store it again from wherever it came from if you need it.
      </p>
    </ConfirmDeleteDialog>
  )
}

/**
 * The identity providers this instance offers (ADR-011).
 *
 * Read-only, and named as such. Providers are environment configuration —
 * `OIDC_PROVIDERS` and each id's own variables — so the honest thing the
 * product can do is say what is configured and where it is configured, rather
 * than render an editor whose Save would have nowhere to go.
 */
function SignInProviders() {
  const providers = useOidcProviders()
  const configured = providers.data?.providers ?? []

  return (
    <SettingsSection
      title="Sign-in providers"
      description="What the sign-in page offers beside a password. Configured in the environment, so this is a readout."
      level={2}
    >
      {providers.isPending ? (
        <p aria-busy="true" className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading the providers
        </p>
      ) : configured.length === 0 ? (
        <p className="text-sm text-muted">
          None configured. Sign-in offers a password, and magic links if mail is set up.
        </p>
      ) : (
        <ul aria-label="Sign-in providers" className="flex flex-col gap-2">
          {configured.map((provider) => (
            <li key={provider.id} className="flex items-center gap-2 text-sm text-foreground">
              <Badge tone="success">Configured</Badge>
              <span>{provider.displayName}</span>
              <code className="text-xs text-muted">{provider.id}</code>
            </li>
          ))}
        </ul>
      )}

      <Callout tone="info" title="Where these come from">
        <p>
          <code>OIDC_PROVIDERS</code> names the providers this instance offers, in the order the
          sign-in page shows them. Each id then has its own variables —{' '}
          <code>OIDC_&lt;ID&gt;_PRESET</code>, <code>OIDC_&lt;ID&gt;_CLIENT_ID</code>,{' '}
          <code>OIDC_&lt;ID&gt;_CLIENT_SECRET</code>, <code>OIDC_&lt;ID&gt;_DISPLAY_NAME</code> —
          and the preset decides which of the rest are needed. See <code>.env.example</code>.
        </p>
      </Callout>
    </SettingsSection>
  )
}
