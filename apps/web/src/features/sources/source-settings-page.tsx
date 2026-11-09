import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useId, useState, type FormEvent, type ReactNode } from 'react'

import { Button, Callout, Input, Spinner, textLinkClassName } from '@quill/ui'

import {
  ApiError,
  useApiClient,
  useConfigureSource,
  useDocuments,
  useLoadedWorkspace,
  useSecrets,
  useWorkspaceSource,
  type SourceDraftBody,
  type SourcePreviewResponseDto,
  type WorkspaceSourceDto,
} from '../../lib/api/index.ts'
import { request } from '../../lib/api/http.ts'
import { RadioChoice } from '../../lib/forms/radio-choice.tsx'
import { SelectField } from '../../lib/forms/select-field.tsx'
import { SettingsSection } from '../settings/settings-frame.tsx'
import { UnsavedChangesGuard } from '../settings/unsaved-changes-guard.tsx'
import {
  EMPTY_FORM,
  TOKEN_USERNAME,
  collectionSlug,
  describeUnreadable,
  draftBody,
  draftKey,
  formFromSource,
  missingFields,
  nameFromPath,
  newCollection,
  settingsBody,
  type FieldErrors,
  type FormCollection,
  type FormField,
  type SourceForm,
} from './source-form-model.ts'
import { SourcePreviewPanel } from './source-preview-panel.tsx'

/**
 * Connecting a workspace to a Git repository, and changing that connection
 * later (ADR-061). One page for both, because they are one question asked
 * twice: where are the documents, and what of them does this workspace read?
 *
 * The flow is check, then preview, then save. Nothing is stored and nothing
 * syncs until the last step, and the last step is offered only for the
 * settings the preview on the page describes: change a field and the
 * preview says it is out of date until it is asked again. The preview is the
 * server's dry run, made with the sync's own planning, so what it shows is
 * what the sync will do.
 *
 * It is for instance administrators, as the API is: a source's credential
 * names a secret of the whole instance, sent to the address on this form.
 * The route says so before this renders.
 */

/** Connecting a native workspace: offered only while it is empty, and said why otherwise. */
export function ConnectSourcePage({ workspaceSlug }: { readonly workspaceSlug: string }) {
  const workspace = useLoadedWorkspace(workspaceSlug).data
  const documents = useDocuments(workspace.id)
  const title = `Connect ${workspace.name} to a repository`

  if (documents.isPending) {
    return (
      <PageFrame title={title}>
        <p aria-busy="true" className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Checking what the workspace holds
        </p>
      </PageFrame>
    )
  }
  const count = documents.data?.length ?? 0
  if (count > 0) {
    return (
      <PageFrame title={title}>
        <Callout
          className="max-w-(--layout-content)"
          tone="warning"
          title="This workspace already has documents"
        >
          <p>
            {count === 1
              ? 'It holds one document'
              : `It holds ${count.toLocaleString('en')} documents`}{' '}
            written here. A workspace read from a repository is written only by its sync, so it has
            to start empty: these would be left behind, and nobody could edit them.
          </p>
          <p>
            Create a new workspace and choose “A Git repository” for it, or move these documents to
            another workspace first.
          </p>
        </Callout>
      </PageFrame>
    )
  }
  return <SourceForm workspace={workspace} saved={null} />
}

/** Changing a sourced workspace's settings. */
export function EditSourcePage({ workspaceSlug }: { readonly workspaceSlug: string }) {
  const workspace = useLoadedWorkspace(workspaceSlug).data
  const saved = useWorkspaceSource(workspace.id)
  /* v8 ignore next -- the loader awaited the source, so it is here on the first render. */
  if (saved.data === undefined) return undefined
  return <SourceForm workspace={workspace} saved={saved.data} />
}

function PageFrame({
  title,
  description,
  children,
}: {
  readonly title: string
  readonly description?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-8 px-4 py-8 sm:px-8">
      <div className="max-w-(--layout-content)">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description === undefined ? undefined : (
          <p className="mt-1 text-sm text-muted">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}

type Workspace = ReturnType<typeof useLoadedWorkspace>['data']

/** A preview asked for, by the settings it was asked with. */
interface Asked {
  readonly body: SourceDraftBody
  readonly key: string
}

function SourceForm({
  workspace,
  saved,
}: {
  readonly workspace: Workspace
  readonly saved: WorkspaceSourceDto | null
}) {
  const editing = saved !== null
  const client = useApiClient()
  const navigate = useNavigate()
  const configure = useConfigureSource(workspace.id)
  const initial = saved === null ? EMPTY_FORM : formFromSource(saved)
  const [form, setForm] = useState<SourceForm>(initial)
  const [shown, setShown] = useState<FieldErrors>({})
  const [rows, setRows] = useState(0)
  const [done, setDone] = useState(false)
  // A saved source is previewed as it stands when the page opens, so the
  // change summary has something to compare against at once.
  const [asked, setAsked] = useState<Asked | null>(() => {
    if (saved === null) return null
    const body = draftBody(initial)
    return { body, key: draftKey(body) }
  })

  const preview = useQuery({
    queryKey: ['source-preview', workspace.id, asked?.key ?? ''],
    queryFn: () =>
      request<SourcePreviewResponseDto>(
        client.POST('/api/workspaces/{id}/source/preview', {
          params: { path: { id: workspace.id } },
          // Present whenever the query is enabled.
          body: asked?.body ?? draftBody(form),
        }),
      ),
    enabled: asked !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
  })

  const currentKey = draftKey(draftBody(form))
  const fresh = asked !== null && asked.key === currentKey
  const dirty = !done && draftKey(draftBody(form)) !== draftKey(draftBody(initial))
  const optionsDirty =
    !done && (form.history !== initial.history || form.commitMessages !== initial.commitMessages)

  // What the server said about the fields, beside the ones it is about.
  const serverErrors: FieldErrors = {}
  let general: { readonly message: string; readonly detail: string | null } | null = null
  if (fresh && preview.isError) {
    const error = preview.error
    const field = error instanceof ApiError ? fieldOf(error.details) : null
    if (field === null) general = { message: describeFailure(error), detail: null }
    else serverErrors[field] = error.message
  }
  const outcome = fresh ? preview.data : undefined
  if (outcome?.outcome === 'unreadable') {
    const unreadable = describeUnreadable(outcome.reason, asked?.body.branch ?? form.branch)
    if (unreadable.field === null)
      general = { message: unreadable.message, detail: outcome.message }
    else {
      serverErrors[unreadable.field] = unreadable.message
      general = { message: unreadable.message, detail: outcome.message }
    }
  }
  if (configure.isError) {
    const field = configure.error instanceof ApiError ? fieldOf(configure.error.details) : null
    if (field !== null) serverErrors[field] = configure.error.message
  }
  const errors: FieldErrors = { ...serverErrors, ...shown }
  const result = outcome?.outcome === 'preview' ? outcome.preview : null
  const choosing =
    result !== null &&
    result.manifest.state === 'problem' &&
    result.manifest.entries.length > 1 &&
    form.manifestEntry === null

  function update(next: Partial<SourceForm>) {
    setForm((current) => ({ ...current, ...next }))
    setShown({})
  }

  function ask(next: SourceForm = form) {
    const missing = missingFields(next)
    setShown(missing)
    if (Object.keys(missing).length > 0) return
    const body = draftBody(next)
    const key = draftKey(body)
    if (asked?.key === key) void preview.refetch()
    else setAsked({ body, key })
  }

  function submitCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    ask()
  }

  function chooseEntry(entry: string) {
    const next = { ...form, manifestEntry: entry }
    setForm(next)
    ask(next)
  }

  const blocker = saveBlocker({ fresh, result, pending: preview.isFetching, form, editing })
  function save() {
    if (blocker !== null) return
    configure.mutate(settingsBody(form, saved), {
      onSuccess: () => {
        setDone(true)
        void navigate({
          to: '/w/$workspaceSlug/source',
          params: { workspaceSlug: workspace.slug },
        })
      },
    })
  }

  const checkId = useId()
  const previewId = useId()
  const statusId = useId()
  return (
    <PageFrame
      title={
        editing
          ? `${workspace.name} repository settings`
          : `Connect ${workspace.name} to a repository`
      }
      description={
        editing
          ? 'Change where this workspace reads from, or what it reads. Preview the change to see what moves, arrives or leaves, then save; saving syncs.'
          : 'Its documents will be written in the repository and read here: every push to the branch arrives as a new revision. Check the repository, preview what it holds, then connect.'
      }
    >
      <UnsavedChangesGuard dirty={dirty || optionsDirty} what="repository settings" />

      <form
        aria-labelledby={checkId}
        noValidate
        onSubmit={submitCheck}
        className="flex max-w-(--layout-content) flex-col gap-4"
      >
        <h2 id={checkId} className="text-xl font-semibold tracking-tight text-foreground">
          Repository
        </h2>
        <Input
          label="Address"
          name="remote"
          required
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/acme/handbook.git"
          description="The https:// address you would clone the repository from."
          value={form.remote}
          error={errors.remote}
          onChange={(event) => {
            update({ remote: event.target.value })
          }}
        />
        <Input
          label="Branch"
          name="branch"
          required
          autoComplete="off"
          spellCheck={false}
          description="Each push to this branch arrives as a new revision."
          value={form.branch}
          error={errors.branch}
          onChange={(event) => {
            update({ branch: event.target.value })
          }}
        />
        <CredentialFields form={form} error={errors.credential} onChange={update} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant={result === null ? 'primary' : 'secondary'}
            loading={preview.isFetching}
          >
            {asked === null ? 'Check the repository' : 'Preview again'}
          </Button>
          <p className="text-xs text-muted">
            {preview.isFetching
              ? `Fetching ${asked?.body.branch ?? form.branch}. This can take up to a minute.`
              : 'Reads the branch without saving anything.'}
          </p>
        </div>
      </form>

      {result === null ? undefined : (
        <WhatToRead
          result={result}
          form={form}
          choosing={choosing}
          error={errors.collections ?? errors.manifestEntry}
          onChooseEntry={chooseEntry}
          onCollections={(collections) => {
            update({ collections })
          }}
          onAdd={() => {
            setRows((count) => count + 1)
            update({ collections: [...form.collections, newCollection(`new-${String(rows)}`)] })
          }}
          onPreview={() => {
            ask()
          }}
          pending={preview.isFetching}
        />
      )}

      <section
        aria-labelledby={previewId}
        className="flex max-w-(--layout-content) min-w-0 flex-col gap-4"
      >
        <h2 id={previewId} className="text-xl font-semibold tracking-tight text-foreground">
          Preview
        </h2>
        <div id={statusId} role="status" aria-live="polite" className="contents">
          <PreviewState
            asked={asked}
            fresh={fresh}
            fetching={preview.isFetching}
            general={general}
            result={result}
            choosing={choosing}
            branch={asked?.body.branch ?? form.branch}
            onPreview={() => {
              ask()
            }}
          />
        </div>
      </section>

      <Options form={form} onChange={update} />

      <section
        aria-label="Save"
        className="flex max-w-(--layout-content) flex-col gap-3 border-t border-border pt-6"
      >
        {configure.isError &&
        (configure.error instanceof ApiError ? fieldOf(configure.error.details) : null) === null ? (
          <Callout
            tone="danger"
            title={editing ? 'Couldn’t save the settings' : 'Couldn’t connect the repository'}
          >
            {describeFailure(configure.error)}
          </Callout>
        ) : undefined}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={save}
            loading={configure.isPending}
            disabled={blocker !== null}
            aria-describedby={blocker === null ? undefined : `${statusId}-blocker`}
          >
            {editing ? 'Save and sync' : 'Connect and sync'}
          </Button>
          {editing ? (
            <Link
              to="/w/$workspaceSlug/source"
              params={{ workspaceSlug: workspace.slug }}
              className={textLinkClassName()}
            >
              Cancel
            </Link>
          ) : (
            <Link
              to="/w/$workspaceSlug"
              params={{ workspaceSlug: workspace.slug }}
              className={textLinkClassName()}
            >
              Not now
            </Link>
          )}
        </div>
        <p id={`${statusId}-blocker`} className="text-xs text-muted">
          {blocker ??
            (editing
              ? 'Saving stores these settings and syncs now. Readers keep what they see until the sync finishes.'
              : 'Connecting stores these settings and syncs now. Documents appear as the sync finishes.')}
        </p>
      </section>
    </PageFrame>
  )
}

/** Why Save is not offered yet, in a sentence; null when it is. */
function saveBlocker(input: {
  readonly fresh: boolean
  readonly result: Extract<SourcePreviewResponseDto, { outcome: 'preview' }>['preview'] | null
  readonly pending: boolean
  readonly form: SourceForm
  readonly editing: boolean
}): string | null {
  const { fresh, result, pending, form } = input
  if (pending) return 'Waiting for the preview.'
  if (!fresh || result === null) {
    return 'Preview these settings first, so you can see what saving does.'
  }
  if (result.manifest.state === 'problem') {
    return result.manifest.entries.length > 1 && form.manifestEntry === null
      ? 'Choose which workspace in the manifest this one reads.'
      : 'Fix the manifest in the repository and preview again: nothing can be read while it has a mistake.'
  }
  if (result.collections.length === 0) {
    return 'Add a collection: without one, nothing in the repository is read.'
  }
  return null
}

const FIELDS: readonly FormField[] = [
  'remote',
  'branch',
  'credential',
  'collections',
  'manifestEntry',
]

/** The form field a refusal names, from `{ field }` in its details. */
function fieldOf(details: unknown): FormField | null {
  if (typeof details !== 'object' || details === null || !('field' in details)) return null
  return FIELDS.find((field) => field === details.field) ?? null
}

function describeFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'workspace_not_empty') {
      return 'This workspace has documents now, so it can’t read from a repository. It must start empty.'
    }
    if (error.status === 429)
      return 'Too many previews in a short time. Wait a minute and try again.'
    if (error.status === 403) return 'Only an instance administrator can connect a repository.'
    return error.message
  }
  return 'Something went wrong on the way. Try again.'
}

function CredentialFields({
  form,
  error,
  onChange,
}: {
  readonly form: SourceForm
  readonly error: string | undefined
  readonly onChange: (next: Partial<SourceForm>) => void
}) {
  const secrets = useSecrets()
  const errorId = useId()
  const { credential } = form
  const names = (secrets.data ?? []).map(({ name }) => name)
  const chosen = credential.kind === 'secret' ? credential.secretName : ''
  // A saved credential naming a secret since deleted is still shown, as it is.
  const options = chosen === '' || names.includes(chosen) ? names : [chosen, ...names]
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-3 border-0 p-0"
      aria-describedby={error === undefined ? undefined : errorId}
      aria-invalid={error !== undefined}
    >
      <legend className="mb-1 text-xs font-medium text-foreground">Access</legend>
      <RadioChoice
        name="credential"
        checked={credential.kind === 'none'}
        label="Public: no credential"
        description="Anyone can clone it."
        onChange={() => {
          onChange({ credential: { kind: 'none' } })
        }}
      />
      <RadioChoice
        name="credential"
        checked={credential.kind === 'secret'}
        label="Private: a token stored as a secret"
        description="The token is kept in this instance’s secrets and sent only to this address. Its value is never shown here."
        onChange={() => {
          onChange({
            credential: { kind: 'secret', username: TOKEN_USERNAME, secretName: '' },
          })
        }}
      />
      {credential.kind === 'secret' ? (
        <div className="ms-6 flex min-w-0 flex-col gap-3">
          <SelectField
            label="Secret"
            name="secretName"
            value={credential.secretName}
            description="Secrets are listed by name only."
            onChange={(event) => {
              onChange({ credential: { ...credential, secretName: event.target.value } })
            }}
          >
            <option value="">
              {secrets.isPending
                ? 'Loading the secrets…'
                : options.length === 0
                  ? 'No secrets stored yet'
                  : 'Choose a secret'}
            </option>
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </SelectField>
          <p className="text-xs text-muted">
            To add one, store the token in{' '}
            <Link to="/admin/settings/secrets" target="_blank" className={textLinkClassName()}>
              Secrets
            </Link>{' '}
            (opens in a new tab) under a name such as <code>sources/handbook</code>, then come back
            and choose it.
          </p>
          <Input
            label="User name"
            name="username"
            autoComplete="off"
            spellCheck={false}
            description="x-access-token for a GitHub or GitLab token; a deploy token’s own user name elsewhere."
            value={credential.username}
            onChange={(event) => {
              onChange({ credential: { ...credential, username: event.target.value } })
            }}
          />
        </div>
      ) : undefined}
      {error === undefined ? undefined : (
        <p id={errorId} role="alert" className="text-2xs leading-normal text-danger">
          {error}
        </p>
      )}
    </fieldset>
  )
}

type Preview = Extract<SourcePreviewResponseDto, { outcome: 'preview' }>['preview']

/** The manifest's workspaces to choose from, or the collections to name when it has none. */
function WhatToRead({
  result,
  form,
  choosing,
  error,
  pending,
  onChooseEntry,
  onCollections,
  onAdd,
  onPreview,
}: {
  readonly result: Preview
  readonly form: SourceForm
  readonly choosing: boolean
  readonly error: string | undefined
  readonly pending: boolean
  readonly onChooseEntry: (entry: string) => void
  readonly onCollections: (collections: readonly FormCollection[]) => void
  readonly onAdd: () => void
  readonly onPreview: () => void
}) {
  const headingId = useId()
  const { manifest } = result
  const entries = manifest.entries
  return (
    <section
      aria-labelledby={headingId}
      className="flex max-w-(--layout-content) min-w-0 flex-col gap-4"
    >
      <h2 id={headingId} className="text-xl font-semibold tracking-tight text-foreground">
        What to read
      </h2>
      {entries.length > 1 ? (
        <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-sm text-foreground">
            The manifest, <code>{manifest.path}</code>, describes{' '}
            {entries.length.toLocaleString('en')} workspaces. Choose the one this workspace reads.
          </legend>
          {entries.map(({ slug, collections }) =>
            slug === null ? undefined : (
              <RadioChoice
                key={slug}
                name="manifestEntry"
                checked={(form.manifestEntry ?? manifest.entry) === slug}
                label={<code>{slug}</code>}
                description={
                  collections === 1
                    ? 'One collection'
                    : `${collections.toLocaleString('en')} collections`
                }
                onChange={() => {
                  onChooseEntry(slug)
                }}
              />
            ),
          )}
          {choosing ? (
            <p className="text-xs text-muted">The preview below appears once you choose.</p>
          ) : undefined}
        </fieldset>
      ) : manifest.state === 'read' ? (
        <p className="text-sm text-muted">
          The manifest, <code>{manifest.path}</code>, decides the collections, so there is nothing
          to choose here. To change them, change the manifest in the repository.
        </p>
      ) : manifest.state === 'absent' ? (
        <CollectionsEditor
          collections={form.collections}
          manifestPath={manifest.path}
          error={error}
          pending={pending}
          onChange={onCollections}
          onAdd={onAdd}
          onPreview={onPreview}
        />
      ) : undefined}
    </section>
  )
}

function CollectionsEditor({
  collections,
  manifestPath,
  error,
  pending,
  onChange,
  onAdd,
  onPreview,
}: {
  readonly collections: readonly FormCollection[]
  readonly manifestPath: string
  readonly error: string | undefined
  readonly pending: boolean
  readonly onChange: (collections: readonly FormCollection[]) => void
  readonly onAdd: () => void
  readonly onPreview: () => void
}) {
  const errorId = useId()
  function change(index: number, next: Partial<FormCollection>) {
    onChange(
      collections.map((collection, at) => (at === index ? { ...collection, ...next } : collection)),
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-muted">
        The repository has no manifest (<code>{manifestPath}</code>), so name the folders or files
        to read. Each becomes a collection, with its folders as pages.
      </p>
      {collections.length === 0 ? undefined : (
        <ol aria-label="Collections" className="flex min-w-0 flex-col gap-3">
          {collections.map((collection, index) => (
            <li
              key={collection.key}
              className="grid min-w-0 grid-cols-1 items-start gap-3 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <Input
                label="Path in the repository"
                name={`collection-${collection.key}-path`}
                autoComplete="off"
                spellCheck={false}
                placeholder="docs/guides"
                value={collection.path}
                onChange={(event) => {
                  const path = event.target.value
                  // The name follows the path until somebody types one of their own.
                  const following =
                    collection.name === '' || collection.name === nameFromPath(collection.path)
                  change(index, following ? { path, name: nameFromPath(path) } : { path })
                }}
              />
              <Input
                label="Collection name"
                name={`collection-${collection.key}-name`}
                autoComplete="off"
                value={collection.name}
                {...(collection.slug === null
                  ? {}
                  : { description: `Keeps its address, ${collectionSlug(collection)}.` })}
                onChange={(event) => {
                  change(index, { name: event.target.value })
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                className="sm:mt-5"
                aria-label={`Remove ${collection.name === '' ? `collection ${String(index + 1)}` : collection.name}`}
                onClick={() => {
                  onChange(collections.filter((_, at) => at !== index))
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ol>
      )}
      {error === undefined ? undefined : (
        <p id={errorId} role="alert" className="text-2xs leading-normal text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={onAdd}>
          Add a collection
        </Button>
        {collections.length === 0 ? undefined : (
          <Button size="sm" loading={pending} onClick={onPreview}>
            Preview these collections
          </Button>
        )}
      </div>
    </div>
  )
}

function PreviewState({
  asked,
  fresh,
  fetching,
  general,
  result,
  choosing,
  branch,
  onPreview,
}: {
  readonly asked: Asked | null
  readonly fresh: boolean
  readonly fetching: boolean
  readonly general: { readonly message: string; readonly detail: string | null } | null
  readonly result: Preview | null
  readonly choosing: boolean
  readonly branch: string
  readonly onPreview: () => void
}) {
  if (asked === null) {
    return (
      <p className="text-sm text-muted">
        Check the repository to see which collections there will be, which pages land in each, and
        what is left out. Nothing is saved until you connect.
      </p>
    )
  }
  if (fetching) {
    return (
      <p aria-busy="true" className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Reading <code>{branch}</code>…
      </p>
    )
  }
  if (!fresh) {
    return (
      <Callout tone="info" title="The settings changed since this preview">
        <p>Preview again to see what the new settings do.</p>
        <Button size="sm" variant="secondary" onClick={onPreview}>
          Preview again
        </Button>
      </Callout>
    )
  }
  if (general !== null) {
    return (
      <Callout tone="danger" title="Couldn’t read the repository">
        <p>{general.message}</p>
        {general.detail === null ? undefined : (
          <details>
            <summary className="focus-ring cursor-pointer text-xs text-muted">
              What Git said
            </summary>
            <pre className="mt-1 text-2xs break-all whitespace-pre-wrap text-muted">
              {general.detail}
            </pre>
          </details>
        )}
      </Callout>
    )
  }
  if (result === null) return undefined
  if (choosing) {
    return (
      <p className="text-sm text-muted">
        Choose a workspace from the manifest to see what it holds.
      </p>
    )
  }
  if (result.manifest.state === 'problem' && result.manifest.problem !== null) {
    const { problem } = result.manifest
    return (
      <Callout tone="danger" title="The manifest has a mistake">
        <p>
          <code>{result.manifest.path}</code>
          {problem.line === null ? '' : `, line ${String(problem.line)}`}:{' '}
          {sentence(problem.message)}
        </p>
        <p>
          Fix it in the repository, push, and preview again. Nothing is read while it has a mistake.
        </p>
      </Callout>
    )
  }
  if (result.origin === 'settings' && result.collections.length === 0) {
    return (
      <p className="text-sm text-muted">
        Add a collection above, then preview it, to see what it holds.
      </p>
    )
  }
  return <SourcePreviewPanel preview={result} branch={branch} />
}

function sentence(text: string): string {
  const capital = `${text.charAt(0).toUpperCase()}${text.slice(1)}`
  return /[.!?]$/u.test(capital) ? capital : `${capital}.`
}

function Options({
  form,
  onChange,
}: {
  readonly form: SourceForm
  readonly onChange: (next: Partial<SourceForm>) => void
}) {
  return (
    <SettingsSection
      level={2}
      title="History and change notes"
      description="How the repository’s commits appear in each page’s history."
    >
      <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-xs font-medium text-foreground">History</legend>
        <RadioChoice
          name="history"
          checked={form.history === 'full'}
          label="Every commit, as its own revision"
          description="Each page’s history shows who changed it and when, back to its first commit."
          onChange={() => {
            onChange({ history: 'full' })
          }}
        />
        <RadioChoice
          name="history"
          checked={form.history === 'head'}
          label="Only the latest commit, imported once"
          description="Faster for a long history. Later pushes still arrive as revisions."
          onChange={() => {
            onChange({ history: 'head' })
          }}
        />
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-xs font-medium text-foreground">Commit messages</legend>
        <RadioChoice
          name="commitMessages"
          checked={form.commitMessages === 'subject'}
          label="Show each commit’s first line as its change note"
          onChange={() => {
            onChange({ commitMessages: 'subject' })
          }}
        />
        <RadioChoice
          name="commitMessages"
          checked={form.commitMessages === 'none'}
          label="Don’t show commit messages"
          description="For readers who shouldn’t see the team’s commit messages."
          onChange={() => {
            onChange({ commitMessages: 'none' })
          }}
        />
      </fieldset>
    </SettingsSection>
  )
}
