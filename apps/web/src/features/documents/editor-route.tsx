import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'

import { BRAND } from '@quill/brand'
import '@quill/ui/styles/editor.css'
import '@quill/ui/styles/table-editor.css'
import '@quill/ui/styles/editor-menus.css'
import { Block, Button, Callout, LayoutGrid, Spinner, toast, tv, type ToastId } from '@quill/ui'
import {
  DocumentEditor,
  createBroadcastDraftChannel,
  insertImage,
  insertLink,
  pageMergeRunner,
  useAutosave,
  useConnectionStatus,
  useDocumentLock,
  useDraftReconciliation,
  useUnsavedChangesGuard,
  type DocumentAst,
  type DocumentEditorHandle,
  type DraftAuthor,
  type LoadedDraft,
} from '@quill/editor'

import {
  ApiError,
  useChildPagesOf,
  useDocument,
  useDocumentEnvelope,
  useMe,
  useOrganisationEmoji,
  useOrganisationLabels,
  usePublishDocument,
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
import { FormError } from '../../lib/forms/form-error.tsx'
import type { PersistentRecoveryStore } from '../../lib/recovery/indexeddb-recovery-store.ts'
import { useRecoveryStore } from '../../lib/recovery/use-recovery-store.ts'
import { documentLink } from '../../lib/routing/document-reference.ts'
import { RouteNotice } from '../workspaces/route-notice.tsx'
import { ShellActions } from '../workspaces/shell-slots.tsx'
import { EditorStatus, OFFLINE_LABEL } from './editor-status.tsx'
import { ImageDialog } from './image-dialog.tsx'
import type { ImageRequest } from './image-dialog.tsx'
import { MergeConflicts } from './merge-conflicts.tsx'
import { MergeDialog } from './merge-dialog.tsx'
import { openEditorLink, sectionAddress } from './editor-links.ts'
import { ReviewActions } from '../review/review-actions.tsx'
import { useDocumentLinkSearch } from './use-document-link-search.ts'
import { DocumentPropertiesPanel } from './properties/document-properties-panel.tsx'
import { useDraftFrontMatter } from './properties/draft-front-matter.ts'
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
    offline: '',
  },
  variants: {
    /*
     * The status in the bar says "offline" on a wide screen; a phone has no
     * room for it there, so the notice says it instead — until the lock may
     * have lapsed, which everybody is told.
     */
    phoneOnly: { true: { offline: 'sm:hidden' } },
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
  // Bumped by restoring a set-aside edit, which remounts the session on the
  // content it should now show (audit 2026-10-11, P0-5).
  const [generation, setGeneration] = useState(0)

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
      frontMatter={content?.frontMatter ?? {}}
      workspaceSlug={workspaceSlug}
      title={document.data.title}
      initialAst={initialAst}
      serverAst={serverAst}
      mergedBy={content?.mergedBy}
      draftVersion={serverVersion}
      baseRevision={draft.data.baseRevision}
      published={envelope.data?.lastPublished?.revision ?? null}
      permissions={envelope.data?.permissions}
      holderName={envelope.data?.lock?.holderName}
      store={store}
      setAside={setAside}
      hasRecovered={generation === 0 && recovery.recovered !== undefined}
      refreshFailed={document.isError || draft.isError}
      onRestoreSetAside={restoreSetAside}
    />
  )
}

interface EditingSessionProps {
  readonly documentId: string
  readonly workspaceSlug: string
  /** The document's title, which its first heading decides. */
  readonly title: string
  /** The draft envelope's front matter, which the properties strip edits. */
  readonly frontMatter: Readonly<Record<string, unknown>>
  /** `undefined` when this release cannot read the stored draft (ADR-033). */
  readonly initialAst: DocumentAst | undefined
  /** The draft as the server holds it: the merge base a fresh session starts from. */
  readonly serverAst: DocumentAst | undefined
  /** Who last merged offline changes into this draft, if anyone has since it was last saved. */
  readonly mergedBy: DraftAuthor | undefined
  readonly draftVersion: number
  readonly baseRevision: string | null
  /** The revision readers see now, which a review compares the draft with; null before the first publish. */
  readonly published: string | null
  readonly permissions: DocumentPermissions | undefined
  readonly holderName: string | undefined
  readonly store: PersistentRecoveryStore
  readonly setAside: PersistentRecoveryStore
  readonly hasRecovered: boolean
  /** A background refresh failed; the session carries on with what it has. */
  readonly refreshFailed: boolean
  readonly onRestoreSetAside: () => void
}

function EditingSession({
  documentId,
  workspaceSlug,
  title,
  frontMatter,
  initialAst,
  serverAst,
  mergedBy,
  draftVersion,
  baseRevision,
  published,
  permissions,
  holderName,
  store,
  setAside,
  hasRecovered,
  refreshFailed,
  onRestoreSetAside,
}: EditingSessionProps) {
  const navigate = useNavigate()
  const styles = editorRouteStyles()

  // Who this session saves as, stamped on each draft it writes so a merge can
  // say whose changes it combined (ADR-021, amendment of 2026-10-11).
  const me = useMe()
  const meId = me.data?.id
  const meName = me.data?.displayName
  const author = useMemo<DraftAuthor | undefined>(
    () =>
      meId === undefined || meName === undefined
        ? undefined
        : { userId: meId, displayName: meName },
    [meId, meName],
  )
  const draftClient = useDraftClient(documentId, author)
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
    ...(serverAst === undefined ? {} : { documentAst: serverAst }),
    canSave: lock.canAutosave,
    channel,
  })
  // What the editor shows. A merge replaces it, and the editor is remounted
  // on the new tree — once, after the merge, never while typing.
  const [content, setContent] = useState(initialAst)
  const [contentGeneration, setContentGeneration] = useState(0)
  const reconcile = useDraftReconciliation({
    lock,
    autosave,
    client: draftClient,
    store,
    merge: pageMergeRunner(),
    onReplace: (ast) => {
      setContent(ast)
      setContentGeneration((current) => current + 1)
    },
    onMerged: (theirs) => {
      toast.info(`Merged your offline changes with ${whoseDraft(theirs, meId)}`)
    },
  })
  const connection = useConnectionStatus({ autosave: autosave.status, lock: lock.status })
  // Read once per session: a reload remounts the session with a fresh read.
  const [setAsideEdit, setSetAsideEdit] = useState(() => setAside.read())
  useUnsavedChangesGuard(autosave.unsaved)

  const editorRef = useRef<DocumentEditorHandle>(null)
  // Loaded before the editor mounts (the route's loader); a label changed while
  // somebody is editing reaches their editor on the next visit, which is enough.
  const labels = useOrganisationLabels()
  // The properties line's record, following the document's front matter
  // block so a property change undoes with everything else.
  const properties = useDraftFrontMatter(documentId, frontMatter, initialAst)
  const emoji = useOrganisationEmoji()
  const publish = usePublishDocument()
  const [merge, setMerge] = useState<MergeRequired | undefined>(undefined)
  const [insertingImage, setInsertingImage] = useState(false)
  // Whether the dialog was asked for a picture or for an SVG drawing.
  const [imagePurpose, setImagePurpose] = useState<'image' | 'drawing'>('image')
  const searchDocuments = useDocumentLinkSearch(workspaceSlug)
  // What a child pages block previews: this page's children, for this person (ADR-054).
  const childPages = useChildPagesOf(documentId)
  // What the slash menu remembers is this person's, so it is kept under their id.
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
   * Publishing writes a revision to the content store, which is slow enough
   * that a writer may look away — one of the three cases
   * `docs/design/feedback.md` names for a promise toast. The Publish button
   * keeps its own spinner throughout; this is what tells them how it ended
   * wherever they are by then, with the one action that follows.
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
        success: {
          title: `Published ${title}`,
          action: { label: 'Read it', onClick: openReadingView },
        },
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
  const reconciling = reconcile.phase
  // A lapsed lock is taken again by itself; only one that could not be is the author's to act on.
  const lockLost =
    (lock.status === 'lost' || autosave.status === 'blocked') && reconciling.status === 'idle'
  const conflicted = reconciling.status === 'conflicted' ? reconciling : undefined
  const heldBy = holderName ?? lock.holder?.displayName
  const canEdit =
    permissions?.edit !== false && !lockedByOther && !lockLost && conflicted === undefined
  // Publishing mid-merge would publish a draft that is about to change.
  const canPublish = canEdit && autosave.status !== 'conflict' && reconciling.status === 'idle'
  // Told on their next load when somebody merged offline changes into their draft.
  const mergedInto =
    mergedBy !== undefined && mergedBy.userId !== meId && autosave.lastSavedAt === null
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
    connection.offline ||
    mergedInto ||
    reconciling.status !== 'idle' ||
    phase.status === 'failed' ||
    initialAst === undefined

  /** The lock is back; send whatever the lost lock held up. */
  function takeLockAgain(take: () => Promise<void>) {
    startLockAction(async () => {
      await take()
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

  /** Why the properties cannot be changed right now, in the words the notices above use. */
  const propertiesReadOnly =
    permissions?.edit === false
      ? 'You can read this document but not edit it.'
      : lockedByOther
        ? `${heldBy ?? 'Someone else'} is editing this document.`
        : lockLost
          ? 'Your lock was lost. Take the lock again to change properties.'
          : undefined

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
          reconcile={reconciling.status}
          // A step of air between what the session is doing and what the author
          // can do about it, so the badge reads as a readout rather than as the
          // first of the buttons.
          className="me-1 hidden sm:block"
          onRetry={autosave.retry}
        />
        {/*
          A writer who cannot publish asks for a review to get a change live, so for them it is
          the primary action; one who can asks as a courtesy, beside Publish (ADR-052).
        */}
        <ReviewActions
          workspaceSlug={workspaceSlug}
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
          <Button
            size="sm"
            loading={publish.isPending}
            disabled={!canPublish}
            onClick={handlePublish}
          >
            Publish
          </Button>
        )}
      </ShellActions>

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

          {connection.offline ? (
            <Block
              className={editorRouteStyles({ phoneOnly: !connection.othersMayEdit }).offline()}
            >
              <Callout tone="warning" title={OFFLINE_LABEL}>
                {connection.othersMayEdit
                  ? 'It has been more than a minute, so someone else may be able to edit this document now. Keep writing: when you are back, your changes are merged with anything they wrote.'
                  : 'Keep writing. Your changes are saved to the server as soon as the connection is back.'}
              </Callout>
            </Block>
          ) : undefined}

          {mergedInto ? (
            <Block>
              <Callout
                tone="info"
                title={`${mergedBy.displayName} merged offline changes into this draft`}
              >
                Their changes and yours are combined below.
              </Callout>
            </Block>
          ) : undefined}

          {conflicted === undefined ? undefined : (
            <Block>
              <MergeConflicts
                merge={conflicted.merge}
                otherName={whoseName(conflicted.theirs, meId)}
                onResolve={reconcile.resolve}
                onKeepMine={reconcile.keepMine}
              />
            </Block>
          )}

          {reconciling.status === 'failed' ? (
            <Block>
              <Callout tone="info" title="Couldn’t reach the server to merge your changes">
                They are kept on this device, and it tries again in a few seconds.
              </Callout>
            </Block>
          ) : undefined}

          {lockedByOther ? (
            <Block>
              <Callout
                tone="warning"
                title={
                  autosave.unsaved
                    ? `${heldBy ?? 'Someone else'} is editing now`
                    : `${heldBy ?? 'Someone else'} is editing this document`
                }
              >
                {autosave.unsaved
                  ? `Your offline changes are kept on this device and will be merged when ${heldBy ?? 'they'} finish${heldBy === undefined ? '' : 'es'}.`
                  : 'Autosave is off while someone else holds the lock, so nothing you type here will be saved. Your changes stay in this browser either way.'}
                {permissions?.manage === true ? (
                  <div className={styles.actionRow()}>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={lockActionPending}
                      onClick={() => {
                        takeLockAgain(lock.takeover)
                      }}
                    >
                      Take over the lock
                    </Button>
                  </div>
                ) : undefined}
              </Callout>
            </Block>
          ) : undefined}

          {lockLost ? (
            <Block>
              <Callout tone="danger" title="Your lock was lost">
                Autosave has stopped, and your last edit is held safely in this browser rather than
                discarded. Take the lock again to send it.
                <div className={styles.actionRow()}>
                  <Button
                    size="sm"
                    loading={lockActionPending}
                    onClick={() => {
                      takeLockAgain(lock.acquire)
                    }}
                  >
                    Take the lock again
                  </Button>
                  {permissions?.manage === true ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={lockActionPending}
                      onClick={() => {
                        takeLockAgain(lock.takeover)
                      }}
                    >
                      Take over
                    </Button>
                  ) : undefined}
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
              frontMatter={properties}
              headingTitle={title}
              editable={canEdit}
              readOnlyReason={propertiesReadOnly}
              tagSuggestions={labels}
              searchDocuments={searchDocuments}
              editor={() => editorRef.current?.editor ?? null}
            />
          </Block>
        </LayoutGrid>
      )}

      {initialAst === undefined ? undefined : (
        <DocumentEditor
          // Remounted on a merged tree, and read-only while a merge waits on the author.
          key={`${contentGeneration}:${conflicted === undefined ? 'editing' : 'resolving'}`}
          ref={editorRef}
          ast={content ?? initialAst}
          editable={conflicted === undefined}
          label={title}
          placeholder="Write, or press / for blocks"
          labels={labels}
          emoji={emoji}
          className={styles.surface()}
          onChange={(handle) => {
            // How to read the tree, not the tree: converting a long document
            // costs several frames, so autosave reads it once, when a save is
            // about to go, rather than on every keystroke (P0-6).
            autosave.change(handle.toMdast)
            properties.follow(handle.editor)
          }}
          {...(recentsKey === undefined ? {} : { recentsKey })}
          slashContributions={drawio.slashContributions}
          imageActions={drawio.imageActions}
          searchDocuments={searchDocuments}
          onOpenLink={(href) => {
            openEditorLink(href, workspaceSlug)
          }}
          linkTo={(fragment) =>
            sectionAddress(workspaceSlug, documentId, fragment, globalThis.location.origin)
          }
          childPages={childPages}
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

/** The name to show for whoever wrote the draft merged into; never this person's own. */
function whoseName(theirs: LoadedDraft, meId: string | undefined): string {
  const writer = theirs.writtenBy
  if (writer === undefined) return 'the other editor'
  return writer.userId === meId ? 'your other tab' : writer.displayName
}

/** "Sam's", "your other tab's", or "the latest draft", for the toast after a merge. */
function whoseDraft(theirs: LoadedDraft, meId: string | undefined): string {
  return theirs.writtenBy === undefined ? 'the latest draft' : `${whoseName(theirs, meId)}’s`
}
