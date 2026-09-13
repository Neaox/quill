import { useState, type FormEvent } from 'react'

import { Badge, Button, Callout, Dialog, Input, Spinner, tv } from '@quill/ui'

import {
  ApiError,
  useCreateShareLink,
  useMe,
  useRevokeShareLink,
  useShareLinks,
  type CreatedShareLink,
  type ShareLinkDto,
  type ShareLinkScope,
} from '../../lib/api/index.ts'
import { revisionDate } from '../../lib/documents/revision-labels.ts'
import { now } from '../../lib/time/clock.ts'
import { SelectField } from '../../lib/forms/select-field.tsx'
import { FormError } from '../../lib/forms/form-error.tsx'
import { ConfirmDeleteDialog } from '../dialogs/confirm-delete-dialog.tsx'
import { ShareLinkAddress } from './share-link-address.tsx'

/**
 * Sharing a document with somebody who has no account (plan section 14, use
 * cases 24 and 26; `docs/architecture/api-contract-share-links.md`).
 *
 * One dialog for the whole of it, because the two halves are one question: a
 * person opens Share to see what doors are already open and then decides
 * whether to open another or close one. The list is therefore not behind a
 * tab.
 *
 * Three rules the shape follows from:
 *
 * - **The token is shown once.** `POST` is the only response that ever
 *   carries it, so the new link's address is held in this component's state
 *   and never in the query cache, and the warning beside it is a statement of
 *   fact rather than caution.
 * - **View is the only role.** Comment and edit links are M7, so the role is
 *   a readout rather than a control that has one choice
 *   (`docs/design/feedback.md`: a control that is not built is not rendered).
 * - **Policy is the organisation's answer, not the person's.** `403
 *   share_links_disabled` replaces the form with the reason, in place, and
 *   leaves the list standing: the links that already exist are still the
 *   record of what was opened, even on an instance that now refuses new ones.
 */

const styles = tv({
  slots: {
    // The fields pair up when the panel has room for two columns and stack on
    // a phone, decided by the panel's own width rather than the viewport's
    // (`docs/architecture/styling.md`).
    form: '@container flex flex-col gap-3 border-b border-border pb-4',
    fields: 'grid gap-3 @sm:grid-cols-2',
    readout: 'flex flex-col gap-1',
    readoutLabel: 'text-xs font-medium text-foreground',
    readoutValue: 'flex items-center gap-2 text-2xs text-muted',
    actions: 'flex flex-wrap items-center justify-end gap-2',
    reason: 'text-2xs text-muted',
    listHeading: 'meta pb-2',
    list: 'flex flex-col gap-3',
    row: 'flex flex-wrap items-start justify-between gap-2 data-revoked:opacity-60',
    rowFacts: 'flex min-w-0 flex-col gap-1',
    rowTitle: 'flex flex-wrap items-center gap-1.5 text-xs font-medium text-foreground',
    rowMeta: 'text-2xs leading-relaxed text-muted',
    empty: 'text-xs text-muted',
  },
})()

/** The expiries offered, and what each one means. `date` asks for one. */
const EXPIRY_PRESETS = [
  { value: '7', label: 'In 7 days' },
  { value: '30', label: 'In 30 days' },
  { value: 'never', label: 'Never' },
  { value: 'date', label: 'On a date…' },
] as const

type ExpiryPreset = (typeof EXPIRY_PRESETS)[number]['value']

const SCOPES: readonly { readonly value: ShareLinkScope; readonly label: string }[] = [
  { value: 'document', label: 'This document' },
  { value: 'subtree', label: 'This document and everything under it' },
]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The instant a link stops working, as the API takes it, or `null` for one
 * that never does.
 *
 * A date somebody picks means *the end of* that day — a link chosen to last
 * until the 20th should still open on the morning of the 20th — **in the day
 * the person choosing it is living in**, which is what a bare date on a form
 * means to them. `new Date(y, m, d, 23, 59, 59, 999)` is local by
 * construction, so a link made in Auckland and one made in Los Angeles each
 * last to the end of their own 20th; writing `T23:59:59.999Z` would have
 * meant one of them died at lunchtime and the other outlived the day it was
 * granted for.
 *
 * An empty date is a caller's mistake rather than a choice, and the one
 * answer it must never get is "never expires" — the opposite of what somebody
 * who chose a date asked for. The form cannot produce it (the field is
 * `required`); this is here so the next caller cannot either.
 */
export function expiryFrom(preset: ExpiryPreset, date: string, from: number): string | null {
  switch (preset) {
    case 'never':
      return null
    case 'date': {
      const [year, month, day] = date.split('-').map(Number)
      if (year === undefined || month === undefined || day === undefined) {
        throw new Error('expiryFrom: the "date" preset needs a date, and was given none')
      }
      return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString()
    }
    default:
      return new Date(from + Number(preset) * DAY_MS).toISOString()
  }
}

/**
 * An instant as the `yyyy-mm-dd` a date field speaks, in the day the person
 * is living in — the same reading of "a date" that `expiryFrom` writes back.
 */
export function localDate(at: number): string {
  const when = new Date(at)
  const month = String(when.getMonth() + 1).padStart(2, '0')
  const day = String(when.getDate()).padStart(2, '0')
  return `${String(when.getFullYear())}-${month}-${day}`
}

/** What a link opens, in the words the create form offers. */
export function scopeLabel(scope: ShareLinkScope): string {
  return SCOPES.find((option) => option.value === scope)?.label ?? scope
}

/**
 * The link's term, as one phrase: revoked beats expired beats a date, because
 * that is the order in which each stops mattering.
 */
export function termLabel(link: ShareLinkDto, asOf: number): string {
  if (link.revokedAt !== null) return `Revoked ${revisionDate(link.revokedAt)}`
  if (link.expiresAt === null) return 'Never expires'
  const expiresAt = Date.parse(link.expiresAt)
  return Number.isNaN(expiresAt) || expiresAt > asOf
    ? `Expires ${revisionDate(link.expiresAt)}`
    : `Expired ${revisionDate(link.expiresAt)}`
}

export interface ShareDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The resolved document id: what a write addresses, never the spelling in the address bar. */
  readonly documentId: string
  readonly title: string
}

export function ShareDialog({ open, onOpenChange, documentId, title }: ShareDialogProps) {
  const links = useShareLinks(documentId, { enabled: open })
  const me = useMe()
  const create = useCreateShareLink()
  const revoke = useRevokeShareLink()

  const [scope, setScope] = useState<ShareLinkScope>('document')
  const [preset, setPreset] = useState<ExpiryPreset>('30')
  const [date, setDate] = useState('')
  /** The one place the raw token ever lives, for as long as the dialog is open. */
  const [created, setCreated] = useState<CreatedShareLink | undefined>(undefined)
  const [revoking, setRevoking] = useState<ShareLinkDto | undefined>(undefined)
  /*
   * "Has this one run out?" is asked as of the moment the dialog was opened.
   * It does not tick — a list that relabelled a row while somebody read it
   * would be movement for nothing — and it is captured rather than read in
   * the render body, which would give two renders of the same state two
   * different answers. `DocumentActionsProvider` keys this component by the
   * opening, so "the moment the dialog was opened" is what a mount is, and a
   * tab left open all afternoon does not reopen Share still believing it is
   * lunchtime.
   */
  const [openedAt] = useState(now)
  /** The end of today where this person is: no earlier date can be chosen. */
  const [earliestDate] = useState(() => localDate(now()))

  const disabledByPolicy =
    create.error instanceof ApiError && create.error.code === 'share_links_disabled'
  /*
   * Creating and revoking need a *verified* address on the server
   * (`requireVerifiedSession`), where listing does not, so an unverified
   * member can see the links and not make one. The control says so rather
   * than failing on press (`docs/design/feedback.md`).
   */
  const unverified = me.data?.emailVerified === false

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    create.mutate(
      { documentId, scope, expiresAt: expiryFrom(preset, date, now()) },
      {
        onSuccess: (result) => {
          setCreated(result)
          // The raw token is answered once and is held in one place. Left in
          // the mutation cache it would outlive the dialog by the default
          // garbage-collection window, for no one to read.
          create.reset()
        },
      },
    )
  }

  function close(next: boolean) {
    if (!next) {
      // The token goes with the dialog: reopening Share must not show an
      // address the server will never answer with again.
      setCreated(undefined)
      create.reset()
    }
    onOpenChange(next)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Share “${title}”`}
      description="A link lets somebody read this document without an account."
      footer={
        <Button
          variant="secondary"
          onClick={() => {
            close(false)
          }}
        >
          Done
        </Button>
      }
    >
      {created === undefined ? undefined : (
        <ShareLinkAddress url={created.url} scope={created.link.scope} />
      )}

      {disabledByPolicy ? (
        <Callout tone="warning" title="Share links are turned off">
          {create.error instanceof ApiError ? create.error.message : ''}. Ask an instance
          administrator to allow them before sharing this document outside the organisation.
        </Callout>
      ) : (
        // Named, like the list below it: the dialog holds two regions that
        // both talk about links — the one that makes one, and the one that
        // shows the ones there are — and each says which it is, to a screen
        // reader and to a test.
        <form aria-label="Create a link" className={styles.form()} onSubmit={submit}>
          <div className={styles.fields()}>
            <SelectField
              label="What it opens"
              value={scope}
              onChange={(event) => {
                setScope(event.currentTarget.value as ShareLinkScope)
              }}
            >
              {SCOPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Expires"
              value={preset}
              onChange={(event) => {
                setPreset(event.currentTarget.value as ExpiryPreset)
              }}
            >
              {EXPIRY_PRESETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>

            {preset === 'date' ? (
              <Input
                label="Expiry date"
                type="date"
                required
                // The server refuses an expiry in the past
                // (`share_link_expiry_in_the_past`); the picker not offering
                // one is the same answer without a round trip.
                min={earliestDate}
                value={date}
                onChange={(event) => {
                  setDate(event.currentTarget.value)
                }}
              />
            ) : undefined}

            <div className={styles.readout()}>
              <p className={styles.readoutLabel()}>Role</p>
              <p className={styles.readoutValue()}>
                <Badge>Viewer</Badge>
                <span>Comment and edit links come later.</span>
              </p>
            </div>
          </div>

          <FormError error={create.error} />

          <div className={styles.actions()}>
            {unverified ? (
              <p className={styles.reason()}>Verify your email address before creating a link.</p>
            ) : undefined}
            <Button type="submit" size="sm" disabled={unverified} loading={create.isPending}>
              Create link
            </Button>
          </div>
        </form>
      )}

      <section aria-label="Links to this document">
        <h3 className={styles.listHeading()}>Links</h3>
        {links.isPending ? (
          <p aria-busy="true" className={styles.empty()}>
            <Spinner /> Loading this document’s links
          </p>
        ) : links.isError ? (
          <FormError error={links.error} />
        ) : links.data.links.length === 0 ? (
          <p className={styles.empty()}>
            No links yet. Anyone you give one to can read this document without signing in.
          </p>
        ) : (
          <ul className={styles.list()}>
            {links.data.links.map((link) => (
              <li
                key={link.id}
                className={styles.row()}
                data-revoked={link.revokedAt === null ? undefined : true}
              >
                <div className={styles.rowFacts()}>
                  <p className={styles.rowTitle()}>
                    {scopeLabel(link.scope)}
                    <Badge tone={link.revokedAt === null ? 'neutral' : 'danger'}>
                      {link.revokedAt === null ? link.role : 'revoked'}
                    </Badge>
                  </p>
                  <p className={styles.rowMeta()}>
                    {termLabel(link, openedAt)} ·{' '}
                    {/* TODO(M3): the route answers a user id and no route
                        resolves one to a name, so the only true thing to say
                        is whether it was this person. */}
                    {link.createdBy === me.data?.id ? 'created by you' : 'created by a colleague'}{' '}
                    <time dateTime={link.createdAt}>{revisionDate(link.createdAt)}</time> ·{' '}
                    {link.lastUsedAt === null ? (
                      'never opened'
                    ) : (
                      <>
                        last opened{' '}
                        <time dateTime={link.lastUsedAt}>{revisionDate(link.lastUsedAt)}</time>
                      </>
                    )}
                  </p>
                </div>
                {link.revokedAt === null ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setRevoking(link)
                    }}
                  >
                    Revoke
                  </Button>
                ) : undefined}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDeleteDialog
        open={revoking !== undefined}
        onOpenChange={(next) => {
          if (!next) {
            setRevoking(undefined)
            // A failure belongs to the link it was attempted on. Left
            // standing, it would greet the next Revoke as though that one had
            // already been refused.
            revoke.reset()
          }
        }}
        title="Revoke this link?"
        confirmLabel="Revoke"
        // A second modal over the first, which the design system raises above
        // it so the dialog underneath is dimmed like any other suspended
        // surface.
        elevation="nested"
        description="It stops working on the very next request, for everybody holding it."
        isPending={revoke.isPending}
        error={revoke.error}
        onConfirm={() => {
          if (revoking === undefined) return
          revoke.mutate(
            { shareLinkId: revoking.id, documentId },
            {
              onSuccess: () => {
                setRevoking(undefined)
              },
            },
          )
        }}
      >
        <p>
          Anyone who has this link loses access to{' '}
          {revoking?.scope === 'subtree'
            ? 'this document and everything under it'
            : 'this document'}
          . People inside the organisation keep whatever access they already had.
        </p>
      </ConfirmDeleteDialog>
    </Dialog>
  )
}
