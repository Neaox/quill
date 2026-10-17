import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, useTransition } from 'react'

import { BRAND } from '@quill/brand'
import '@quill/ui/styles/editor.css'
import { Block, Button, Callout, LayoutGrid, Spinner, toast, tv, type ToastId } from '@quill/ui'
import {
  DocumentEditor,
  applyFrontMatter,
  createBroadcastDraftChannel,
  insertImage,
  insertLink,
  useAutosave,
  useDocumentLock,
  useUnsavedChangesGuard,
  type DocumentAst,
  type DocumentEditorHandle,
  type LockStatus,
} from '@quill/editor'

import {
  ApiError,
  useDocument,
  useDocumentEnvelope,
  useMe,
  useOrganisationEmoji,
  useOrganisationLabels,
  usePublishDocument,
  useRevertPreview,
  type DocumentDto,
  type DocumentPermissions,
  type MergeRequired,
} from '../../lib/api/index.ts'
import { useDraft } from '../../lib/api/drafts.ts'
import { useDraftClient, useLockClient } from '../../lib/api/editor-clients.ts'
// By its own path rather than through `lib/api`'s barrel: see the note there.
// Uploading is the editor's alone, and the reading route pays for whatever the
// barrel reaches.
import { ATTACHMENT_MAX_BYTES, useUploadAttachment } from '../../lib/api/attachments.ts'
import { isDocumentTree, readDraftContent } from '../../lib/documents/draft-content.ts'
import { useChildDocuments } from '../../lib/documents/use-child-documents.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import type { PersistentRecoveryStore } from '../../lib/recovery/indexeddb-recovery-store.ts'
import { useRecoveryStore } from '../../lib/recovery/use-recovery-store.ts'
import { documentLink } from '../../lib/routing/document-reference.ts'
import { RouteNotice } from '../workspaces/route-notice.tsx'
import { ShellActions } from '../workspaces/shell-slots.tsx'
import { EditorStatus } from './editor-status.tsx'
import { ImageDialog } from './image-dialog.tsx'
import type { ImageRequest } from './image-dialog.tsx'
import { MergeDialog } from './merge-dialog.tsx'
import { DraftPreviewLink } from './draft-preview-link.tsx'
import { ReviewActions } from '../review/review-actions.tsx'
import { PublishButton } from './publish-button.tsx'
import { ChangesReview } from './changes-review.tsx'
import { ReviewButton } from './review-button.tsx'
import { useDocumentLinkSearch } from './use-document-link-search.ts'
import { DocumentPropertiesPanel } from './properties/document-properties-panel.tsx'
import { useDrawio } from './drawio/use-drawio.tsx'

export const editorRouteStyles = tv({
  slots: {
    pending: 'flex items-center justify-center py-24',
    notices: 'flex flex-col gap-3 pt-6',
    /*
     * The canvas opens the writing surface 32px below the bar, with the
     * document's facts before its title. The properties strip takes that
     * place, and the body starts one step of the reading rhythm under the
     * rule that closes it — the strip's own 16px, then 16px more.
     */
    properties: 'pt-8',
    surface: 'pt-4 pb-24',
    actionRow: 'flex flex-wrap gap-2 pt-3',
  },
})

const routeApi = getRouteApi('/_authenticated/w/$workspaceSlug/d/$documentId/edit')

/**
 * Writing a document.
 *
 * Everything the editor needs from the outside is an adapter this application
 * owns (`lib/api/editor-clients.ts` for drafts and locks,
 * `lib/recovery` for the IndexedDB buffer), which is why `@quill/editor`
 * makes no requests and can be tested with fakes. This route is where they
 * are wired together, and where the three things ADR-021 says a writer must
 * never be lied to about are shown: whether the lock is held, whether the
 * last edit reached the server, and what to do when either answer is no.
 *
 * It renders inside the workspace shell rather than around one: the header,
 * the rail and the tree are the layout route's and keep their DOM when a
 * reader presses Edit. What this page adds to the bar — the session's status
 * and Publish — it renders into the shell's actions slot.
 */
export function EditorRoute() {
  const { workspaceSlug, documentId } = routeApi.useParams()
  const document = useDocument(documentId)
  const draft = useDraft(documentId)
  const envelope = useDocumentEnvelope(documentId)
  const recovery = useRecoveryStore(documentId)
  const styles = editorRouteStyles()
  // Bumped by an explicit reload or restore, which remounts the session on
  // the content it should now show (audit 2026-10-11, P0-5).
  const [generation, setGeneration] = useState(0)
  const [reloading, startReload] = useTransition()

  // Both states render in the shell's main column, never over the whole page:
  // the sidebar and the header belong to the layout route and do not move when
  // a writer opens a document (docs/design/feedback.md).
  if (document.isPending || draft.isPending || !recovery.isReady) {
    return (
      <div className={styles.pending()}>
        <Spinner className="size-6" />
      </div>
    )
  }

  // Only a document that never loaded is one that cannot be opened. A failed
  // *background* refresh keeps the data it had, and must never replace an
  // editor somebody is typing into (audit 2026-10-11, P0-2).
  if (document.data === undefined || draft.data === undefined) {
    const error = document.error ?? draft.error
    return (
      <RouteNotice
        title="Couldn't open this document for editing"
        body={
          error instanceof ApiError
            ? error.message
            : 'Something went wrong on the way. Reload the page to try again.'
        }
      />
    )
  }

  const content = readDraftContent(draft.data.ast)
  const serverAst = isDocumentTree(content?.ast) ? content.ast : undefined
  const { store, setAside } = recovery
  // An edit that never reached the server is what the author last saw, so it
  // is what the editor opens on; autosave then sends it. Showing the server's
  // copy instead would let the next keystroke save over the recovered edit.
  const initialAst = serverAst === undefined ? undefined : (store.read()?.ast ?? serverAst)
  const serverVersion = draft.data.draftVersion

  /**
   * Replaces the editor's content with the server's draft at its version. The
   * unsent edit is set aside — kept in this browser and offered back — rather
   * than sent against a version that is gone or dropped without a word.
   */
  function reloadDraft(bufferUnsent: () => void) {
    startReload(async () => {
      const result = await draft.refetch()
      if (result.isError) {
        toast.danger('Couldn’t reload the draft. Your change is still here; try again.')
        return
      }
      // The last keystrokes may not have been read into the buffer yet; read
      // them now, in the same tick as the remount, so none are left behind.
      bufferUnsent()
      const unsent = store.read()
      if (unsent !== undefined) {
        setAside.write(unsent)
        store.clear()
      }
      setGeneration((current) => current + 1)
    })
  }

  /** Puts a set-aside edit back in the editor, to be saved over the current draft. */
  function restoreSetAside() {
    const kept = setAside.read()
    if (kept === undefined) return
    store.write({ ...kept, expectedVersion: serverVersion })
    setAside.clear()
    setGeneration((current) => current + 1)
  }

  return (
    <EditingSession
      key={`${documentId}:${generation}`}
      documentId={documentId}
      document={document.data}
      frontMatter={content?.frontMatter ?? {}}
      workspaceSlug={workspaceSlug}
      title={document.data.title}
      initialAst={initialAst}
      draftVersion={serverVersion}
      baseRevision={draft.data.baseRevision}
      published={envelope.data?.lastPublished?.revision ?? null}
      permissions={envelope.data?.permissions}
      holderName={envelope.data?.lock?.holderName}
      store={store}
      setAside={setAside}
      hasRecovered={generation === 0 && recovery.recovered !== undefined}
      refreshFailed={document.isError || draft.isError}
      reloading={reloading}
      onReloadDraft={reloadDraft}
      onRestoreSetAside={restoreSetAside}
    />
  )
}

interface EditingSessionProps {
  readonly documentId: string
  /** The document itself, whose id the workspace tree is keyed by. */
  readonly document: DocumentDto
  readonly workspaceSlug: string
  /** The document's title, which its first heading decides. */
  readonly title: string
  /** The draft envelope's front matter, which the properties strip edits. */
  readonly frontMatter: Readonly<Record<string, unknown>>
  /** `undefined` when this release cannot read the stored draft (ADR-033). */
  readonly initialAst: DocumentAst | undefined
  readonly draftVersion: number
  readonly baseRevision: string | null
  /** The revision on the page now, which Publish measures the draft against. */
  readonly published: string | null
  readonly permissions: DocumentPermissions | undefined
  readonly holderName: string | undefined
  readonly store: PersistentRecoveryStore
  readonly setAside: PersistentRecoveryStore
  readonly hasRecovered: boolean
  /** A background refresh failed; the session carries on with what it has. */
  readonly refreshFailed: boolean
  readonly reloading: boolean
  /** Takes the session's way of buffering its unread edit, so nothing typed is left out. */
  readonly onReloadDraft: (bufferUnsent: () => void) => void
  readonly onRestoreSetAside: () => void
}

function EditingSession({
  documentId,
  document,
  workspaceSlug,
  title,
  frontMatter,
  initialAst,
  draftVersion,
  baseRevision,
  published,
  permissions,
  holderName,
  store,
  setAside,
  hasRecovered,
  refreshFailed,
  reloading,
  onReloadDraft,
  onRestoreSetAside,
}: EditingSessionProps) {
  const navigate = useNavigate()
  const styles = editorRouteStyles()

  // For the child-documents block, which shows what is beneath this document.
  const childDocuments = useChildDocuments(document, workspaceSlug)

  const draftClient = useDraftClient(documentId)
  const lockClient = useLockClient(documentId)
  const lock = useDocumentLock({ client: lockClient })
  // The lock buttons start async work with no mutation hook behind it, so the
  // transition's pending flag is what puts the spinner on the button pressed
  // (docs/design/feedback.md).
  const [lockActionPending, startLockAction] = useTransition()
  // The other tabs of this browser on the same document: a save there makes
  // this tab's draft stale at once, not on its next save (P0-5).
  const [channel] = useState(() => createBroadcastDraftChannel(`${BRAND.slug}-draft:${documentId}`))
  const autosave = useAutosave({
    client: draftClient,
    store,
    documentVersion: draftVersion,
    canSave: lock.canAutosave,
    channel,
  })
  // Read once per session: a reload remounts the session with a fresh read.
  const [setAsideEdit, setSetAsideEdit] = useState(() => setAside.read())
  useUnsavedChangesGuard(autosave.unsaved)

  const editorRef = useRef<DocumentEditorHandle>(null)
  // Loaded before the editor mounts (the route's loader); a label changed while
  // somebody is editing reaches their editor on the next visit, which is enough.
  const labels = useOrganisationLabels()
  const emoji = useOrganisationEmoji()
  const publish = usePublishDocument()
  const revertPreview = useRevertPreview()
  // The review of what is waiting to be published, and the change it opened on.
  const [review, setReview] = useState<{ readonly change?: string | undefined } | undefined>(
    undefined,
  )
  const [merge, setMerge] = useState<MergeRequired | undefined>(undefined)
  const [insertingImage, setInsertingImage] = useState(false)
  // Whether the dialog was asked for a picture or for an SVG drawing.
  const [imagePurpose, setImagePurpose] = useState<'image' | 'drawing'>('image')
  const searchDocuments = useDocumentLinkSearch(workspaceSlug)
  // What the slash menu remembers is this person's, so it is kept under their id.
  const me = useMe()
  const recentsKey = me.data === undefined ? undefined : `editor.slash.recent.${me.data.id}`
  // The file a drag or a paste brought in, waiting for the alternative text
  // the dialog asks for before anything is uploaded.
  const [droppedFile, setDroppedFile] = useState<File | undefined>(undefined)
  const upload = useUploadAttachment()
  // draw.io (ADR-043): its slash item, "Edit diagram", and the editor session.
  const drawio = useDrawio({ documentId, place })
  // One promise toast per publish (`docs/design/feedback.md`): a retry passes
  // the previous id back so it replaces that toast rather than stacking one.
  const publishToastId = useRef<ToastId | undefined>(undefined)

  const { acquire } = lock
  const acquired = useRef(false)
  // Takes the document's lock on the server (ADR-021) — the external system
  // this session holds for as long as it is mounted; `useDocumentLock` then
  // owns the heartbeat and releases it on the way out. The ref guards against
  // re-acquiring when the hook hands back a fresh `acquire` on a re-render.
  useEffect(() => {
    if (acquired.current) return
    acquired.current = true
    void acquire()
  }, [acquire])

  function openReadingView() {
    void navigate(documentLink(workspaceSlug, documentId))
  }

  /**
   * Leaving without publishing. What was typed is sent first, so the draft the
   * author comes back to (or previews) is the one they saw; the lock is let go
   * on the way out, as it is whenever the editor goes. What cannot be sent
   * stays in this browser, and is offered back the next time (the recovery
   * store), so a failed save never stops the author leaving.
   */
  async function flushUnsaved() {
    if (autosave.unsaved) await autosave.flush()
  }

  async function handleDone() {
    await flushUnsaved()
    openReadingView()
  }

  /**
   * Puts changes since the published page back in the draft. The server works out the
   * draft with them put back, and the editor takes it as an edit of its own: one step
   * that Undo reverses, saved the way anything typed is.
   */
  async function putChangesBack(ids: readonly string[]) {
    try {
      const reverted = await revertPreview.mutateAsync({
        documentId,
        from: published,
        draftVersion: autosave.draftVersion,
        changes: ids,
      })
      const content = readDraftContent(reverted.ast)
      const handle = editorRef.current
      if (handle === null || !isDocumentTree(content?.ast)) {
        toast.danger('Couldn’t put those changes back. Your draft is as it was.')
        return
      }
      handle.replaceContent(content.ast)
      autosave.change(handle.toMdast)
      toast.success(
        ids.length === 1
          ? 'Put that change back. Undo brings it back again.'
          : `Put ${String(ids.length)} changes back. Undo brings them back again.`,
      )
    } catch (error) {
      toast.danger(
        error instanceof ApiError && error.status === 409
          ? 'Your draft changed while you were looking. The changes shown are the latest; try again.'
          : 'Couldn’t put those changes back. Your draft is as it was.',
      )
    }
  }

  /**
   * Publishing writes a revision to the content store, which is slow enough
   * that a writer may look away — one of the three cases
   * `docs/design/feedback.md` names for a promise toast. The Publish button
   * keeps its own spinner throughout; this is what tells them how it ended
   * wherever they are by then. A publish ends the editing session by taking
   * the writer to the page it made, so the toast has no action of its own: the
   * one it had ("Read it") went where they already were.
   *
   * A `merge-required` is a `200` that is nonetheless not a publish (ADR-015):
   * the dialog it opens is where it gets resolved, and the toast settles as
   * "did not publish" rather than claiming a revision that does not exist.
   */
  function handlePublish() {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    publishToastId.current = toast.promise(
      promise,
      {
        loading: `Publishing ${title}`,
        success: { title: `Published ${title}` },
        error: (reason) => ({
          title:
            reason instanceof Error
              ? reason.message
              : `Couldn't publish ${title}. Your draft is saved; try again.`,
        }),
      },
      publishToastId.current === undefined ? {} : { id: publishToastId.current },
    )

    void autosave.flush().then(() => {
      publish.mutate(
        { documentId, base: baseRevision },
        {
          onSuccess: (result) => {
            if (result.kind === 'merge-required') {
              setMerge(result)
              reject(
                new Error(
                  'Somebody else published while you were writing. Resolve the differences to publish yours.',
                ),
              )
              return
            }
            resolve()
            openReadingView()
          },
          onError: reject,
        },
      )
    }, reject)
  }

  const lockedByOther = lock.status === 'held_by_other'
  const lockLost = lock.status === 'lost' || autosave.status === 'blocked'
  // Whoever the server says has it, from the lock's own answer or from a save it refused.
  const holder = lock.holder ?? autosave.holder
  const someoneHolds = holder !== null
  const heldBy = holderName ?? holder?.displayName
  // Who a takeover takes the document from, said as the person it is.
  const takenFrom = heldBy ?? 'the current editor'
  const canEdit = permissions?.edit !== false && !lockedByOther && !lockLost
  // Publishing over a conflict would publish the other draft, not this one.
  const canPublish = canEdit && autosave.status !== 'conflict'
  const { phase } = autosave
  /*
   * The notices region takes its space only when it has something in it. A
   * region that is always there puts a band of nothing above the document and
   * moves the whole surface off the rhythm the canvas sets.
   */
  const hasNotices =
    publish.error !== null ||
    hasRecovered ||
    refreshFailed ||
    setAsideEdit !== undefined ||
    lockedByOther ||
    lockLost ||
    phase.status === 'conflict' ||
    phase.status === 'failed' ||
    initialAst === undefined

  /**
   * Gets the lock back, or takes it over, and says how it went: a press that changes who may
   * save is one the author must never have to wonder about. When it worked, whatever the lost
   * lock held up is sent; when it did not, the reason is said and the edit stays where it is.
   */
  function takeLockAgain(take: () => Promise<LockStatus>, how: 'resume' | 'takeover') {
    startLockAction(async () => {
      let status: LockStatus
      try {
        status = await take()
      } catch {
        toast.danger(
          'Couldn’t reach the server for the lock. Your edit is safe in this browser; try again.',
        )
        return
      }
      if (status !== 'held') {
        toast.danger(
          status === 'held_by_other'
            ? `${takenFrom} is editing now, so the lock is not free. Your edit is safe in this browser.`
            : 'Couldn’t get the lock. Your edit is safe in this browser; try again.',
        )
        return
      }
      const sending = autosave.unsaved ? ' Your last edit is being saved.' : ''
      toast.success(
        how === 'takeover'
          ? `You took over from ${takenFrom}. You can save again.${sending}`
          : `You have the lock again. You can save again.${sending}`,
      )
      autosave.retry()
    })
  }

  /**
   * An image was asked for, from a file or from an address.
   *
   * A link is inserted as it stands. A file is uploaded first, and only lands
   * in the document once the server has accepted it — so a refusal (too large,
   * the wrong type, an SVG) leaves the dialog open with the reason in it rather
   * than a broken picture in the document.
   */
  function handleInsertImage(request: ImageRequest) {
    if (request.kind === 'link') {
      placeImage(request.url, request.alt)
      setInsertingImage(false)
      setDroppedFile(undefined)
      return
    }
    upload.mutate(
      { documentId, file: request.file },
      {
        onSuccess: (attachment) => {
          // What it *is*, not what the file was called: a PDF becomes a link,
          // because an `<img>` pointing at one is a broken image. The server's
          // sniffed type is the only trustworthy answer to that question.
          if (attachment.contentType.startsWith('image/')) {
            placeImage(attachment.url, request.alt)
          } else {
            place((editor) =>
              insertLink({ href: attachment.url, text: request.alt })(
                editor.state,
                editor.view.dispatch,
              ),
            )
          }
          setInsertingImage(false)
          setDroppedFile(undefined)
        },
      },
    )
  }

  /** Puts the image where the caret is, and queues the save any other edit would. */
  function placeImage(src: string, alt: string) {
    place((editor) => insertImage({ src, alt })(editor.state, editor.view.dispatch))
  }

  /** Runs a command against the live editor and queues the save every edit queues. */
  function place(command: (editor: NonNullable<DocumentEditorHandle['editor']>) => void) {
    const handle = editorRef.current
    const editor = handle?.editor
    if (handle == null || editor == null) return
    command(editor)
    autosave.change(handle.toMdast)
  }

  /**
   * A property changed. The draft envelope has the new record by the time this
   * runs; what is left is to put the same record on the document's own front
   * matter block — so the YAML the author's file keeps stays in step with it —
   * and to queue the save the way any other edit does.
   */
  function handlePropertiesWritten(next: Record<string, unknown>) {
    const handle = editorRef.current
    if (handle === null) return
    const editor = handle.editor
    if (editor !== null) applyFrontMatter(next)(editor.state, editor.view.dispatch)
    autosave.change(handle.toMdast)
  }

  return (
    <>
      {/* The header, the rail and the tree belong to the workspace layout and
          keep their DOM across every navigation inside it; what this page adds
          to the bar is what this page is responsible for. */}
      <ShellActions>
        <EditorStatus
          autosave={autosave.status}
          lock={lock.status}
          holderName={heldBy}
          // A step of air between what the session is doing and what the author
          // can do about it, so the badge reads as a readout rather than as the
          // first of the buttons.
          className="me-1 hidden sm:block"
          onRetry={autosave.retry}
        />
        {/* Draft first, so what is checked is what Publish would send. */}
        <DraftPreviewLink
          documentId={documentId}
          published={published}
          saved={autosave.draftVersion}
          unsaved={autosave.unsaved}
          // What was just typed has to be on the server for the preview to show it.
          beforeOpen={flushUnsaved}
          onReview={(change) => {
            setReview({ change })
          }}
        />
        {/* Leaving is always allowed: not holding the lock does not keep you in. */}
        <Button size="sm" variant="secondary" onClick={() => void handleDone()}>
          Done
        </Button>
        <ReviewButton
          documentId={documentId}
          published={published}
          saved={autosave.draftVersion}
          unsaved={autosave.unsaved}
          onReview={() => {
            setReview({})
          }}
        />
        {/*
          A writer who cannot publish asks for a review to get a change live, so for them it is
          the primary action; one who can asks as a courtesy, beside Publish (ADR-052).
        */}
        <ReviewActions
          documentId={documentId}
          title={title}
          canEdit={canEdit}
          canPublish={permissions?.publish !== false}
          published={published}
          primary={permissions?.publish === false}
          beforeRequest={async () => {
            if (autosave.unsaved) await autosave.flush()
          }}
        />
        {permissions?.publish === false ? undefined : (
          <PublishButton
            onReview={(change) => {
              setReview({ change })
            }}
            documentId={documentId}
            published={published}
            saved={autosave.draftVersion}
            unsaved={autosave.unsaved}
            loading={publish.isPending}
            blocked={!canPublish}
            onPublish={handlePublish}
          />
        )}
      </ShellActions>

      {/* Mounted only while it is open: its comparison is the heavy one, drawn change by change. */}
      {review === undefined ? undefined : (
        <ChangesReview
          documentId={documentId}
          published={published}
          saved={autosave.draftVersion}
          open
          onOpenChange={(open) => {
            if (!open) setReview(undefined)
          }}
          initial={review.change}
          revert={{
            allowed: canPublish && !autosave.unsaved,
            reason: autosave.unsaved
              ? 'Your latest edits are still being saved.'
              : 'Changes can be put back only while you are editing.',
            run: putChangesBack,
          }}
        />
      )}

      {!hasNotices ? undefined : (
        <LayoutGrid className={styles.notices()}>
          <Block>
            <FormError error={publish.error} />
          </Block>

          {hasRecovered ? (
            <Block>
              <Callout tone="info" title="Recovered an unsent edit">
                The last change you made in this browser had not reached the server. It is back in
                the document below and will be saved as soon as the lock allows.
              </Callout>
            </Block>
          ) : undefined}

          {lockedByOther ? (
            <Block>
              <Callout
                tone="warning"
                title={`${heldBy ?? 'Someone else'} is editing this document`}
              >
                Autosave is off while someone else holds the lock, so nothing you type here will be
                saved. Your changes stay in this browser either way.
                {permissions?.manage === true ? (
                  <>
                    <p className="mt-2">
                      As a manager you can take over now. That ends {takenFrom}’s session at once:
                      what they had not saved stays in their browser, and they can take it back once
                      you are done.
                    </p>
                    <div className={styles.actionRow()}>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={lockActionPending}
                        onClick={() => {
                          takeLockAgain(lock.takeover, 'takeover')
                        }}
                      >
                        Take over from {takenFrom}
                      </Button>
                    </div>
                  </>
                ) : undefined}
              </Callout>
            </Block>
          ) : undefined}

          {lockLost ? (
            <Block>
              <Callout tone="danger" title="Your lock was lost">
                Autosave has stopped, and your last edit is held safely in this browser rather than
                discarded. <strong>Resume editing</strong> gets the lock back and sends it, if
                nobody else has taken the document since.
                {permissions?.manage === true && someoneHolds ? (
                  <>
                    {' '}
                    If {takenFrom} has, <strong>Take over</strong> ends their session and puts you
                    back in; what they had not saved stays in their browser.
                  </>
                ) : undefined}
                <div className={styles.actionRow()}>
                  <Button
                    size="sm"
                    loading={lockActionPending}
                    onClick={() => {
                      takeLockAgain(lock.acquire, 'resume')
                    }}
                  >
                    Resume editing
                  </Button>
                  {permissions?.manage === true && someoneHolds ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={lockActionPending}
                      onClick={() => {
                        takeLockAgain(lock.takeover, 'takeover')
                      }}
                    >
                      Take over from {takenFrom}
                    </Button>
                  ) : undefined}
                </div>
              </Callout>
            </Block>
          ) : undefined}

          {phase.status === 'conflict' ? (
            <Block>
              <Callout tone="warning" title="This draft changed somewhere else">
                Another tab or another session saved a newer draft, so nothing more is saved from
                here until you choose. Reload it to carry on from the newer draft; anything you had
                not saved is set aside and offered back, never thrown away. Or keep yours, which
                saves it over the newer draft.
                <div className={styles.actionRow()}>
                  <Button
                    size="sm"
                    loading={reloading}
                    onClick={() => {
                      onReloadDraft(autosave.buffer)
                    }}
                  >
                    Reload the draft
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void autosave.keepMine()
                    }}
                  >
                    Keep mine
                  </Button>
                </div>
              </Callout>
            </Block>
          ) : undefined}

          {setAsideEdit === undefined ? undefined : (
            <Block>
              <Callout tone="info" title="Your unsaved change was set aside">
                You reloaded a newer draft. The change you had not saved is kept in this browser.
                Restoring it puts it back in the editor and saves it over this draft.
                <div className={styles.actionRow()}>
                  <Button size="sm" variant="secondary" onClick={onRestoreSetAside}>
                    Restore my change
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAside.clear()
                      setSetAsideEdit(undefined)
                    }}
                  >
                    Discard it
                  </Button>
                </div>
              </Callout>
            </Block>
          )}

          {phase.status === 'failed' ? (
            <Block>
              <Callout tone="danger" title="Couldn’t save your last change">
                <p>{phase.reason}</p>
                <p>Your change is kept in this browser, and the next edit tries again.</p>
                <div className={styles.actionRow()}>
                  <Button size="sm" variant="secondary" onClick={autosave.retry}>
                    Retry
                  </Button>
                </div>
              </Callout>
            </Block>
          ) : undefined}

          {refreshFailed ? (
            <Block>
              <Callout tone="info" title="Couldn’t refresh this document">
                Keep writing: this does not stop your changes being saved, and it will try again.
              </Callout>
            </Block>
          ) : undefined}

          {initialAst === undefined ? (
            <Block>
              <Callout tone="danger" title="This draft cannot be opened">
                It was written by a newer version of the platform than this one. Updating will make
                it readable again; nothing has been lost.
              </Callout>
            </Block>
          ) : undefined}
        </LayoutGrid>
      )}

      {initialAst === undefined ? undefined : (
        <LayoutGrid className={styles.properties()}>
          <Block>
            <DocumentPropertiesPanel
              documentId={documentId}
              frontMatter={frontMatter}
              headingTitle={title}
              editable={canEdit}
              onWritten={handlePropertiesWritten}
            />
          </Block>
        </LayoutGrid>
      )}

      {initialAst === undefined ? undefined : (
        <DocumentEditor
          ref={editorRef}
          ast={initialAst}
          label={title}
          placeholder="Write, or press / for blocks"
          labels={labels}
          emoji={emoji}
          childDocuments={childDocuments}
          className={styles.surface()}
          onChange={(handle) => {
            // How to read the tree, not the tree: converting a long document
            // costs several frames, so autosave reads it once, when a save is
            // about to go, rather than on every keystroke (P0-6).
            autosave.change(handle.toMdast)
          }}
          {...(recentsKey === undefined ? {} : { recentsKey })}
          slashContributions={drawio.slashContributions}
          imageActions={drawio.imageActions}
          searchDocuments={searchDocuments}
          onRequest={(request) => {
            setImagePurpose(request.kind)
            setDroppedFile(undefined)
            upload.reset()
            setInsertingImage(true)
          }}
          onFiles={({ files }) => {
            // One file, one image: the dialog asks for the alternative text
            // each one needs, so a drop of several opens on the first and the
            // rest are dropped rather than inserted undescribed.
            const [first] = files
            if (first === undefined) return
            upload.reset()
            setImagePurpose('image')
            setDroppedFile(first)
            setInsertingImage(true)
          }}
        />
      )}

      <MergeDialog
        merge={merge}
        onClose={() => {
          setMerge(undefined)
        }}
        onCompare={() => {
          const current = merge?.current
          setMerge(undefined)
          if (current === undefined) return
          void navigate({
            to: '/w/$workspaceSlug/d/$documentId',
            params: { workspaceSlug, documentId },
            search: { ...(baseRevision === null ? {} : { from: baseRevision }), to: current },
          })
        }}
      />

      <ImageDialog
        maxBytes={ATTACHMENT_MAX_BYTES}
        open={insertingImage}
        onOpenChange={(next) => {
          setInsertingImage(next)
          if (!next) {
            setDroppedFile(undefined)
            upload.reset()
          }
        }}
        file={droppedFile}
        uploading={upload.isPending}
        error={upload.error}
        onSubmit={handleInsertImage}
        purpose={imagePurpose}
      />

      {drawio.element}
    </>
  )
}
