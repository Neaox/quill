import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, useTransition } from 'react'

import { Block, Button, Callout, LayoutGrid, Spinner, toast, tv, type ToastId } from '@quill/ui'
import {
  DocumentEditor,
  applyFrontMatter,
  insertImage,
  useAutosave,
  useDocumentLock,
  useUnsavedChangesGuard,
  type DocumentAst,
  type DocumentEditorHandle,
} from '@quill/editor'

import {
  ApiError,
  useDocument,
  useDocumentEnvelope,
  useDraft,
  useDraftClient,
  useLockClient,
  usePublishDocument,
  type DocumentPermissions,
  type MergeRequired,
} from '../../lib/api/index.ts'
import { isDocumentTree, readDraftContent } from '../../lib/documents/draft-content.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import type { PersistentRecoveryStore } from '../../lib/recovery/indexeddb-recovery-store.ts'
import { useRecoveryStore } from '../../lib/recovery/use-recovery-store.ts'
import { documentLink } from '../../lib/routing/document-reference.ts'
import { RouteNotice } from '../workspaces/route-notice.tsx'
import { ShellActions } from '../workspaces/shell-slots.tsx'
import { EditorStatus } from './editor-status.tsx'
import { ImageUrlDialog } from './image-url-dialog.tsx'
import { MergeDialog } from './merge-dialog.tsx'
import { DocumentPropertiesPanel } from './properties/document-properties-panel.tsx'

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

  if (document.isError || draft.isError) {
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
  const initialAst = isDocumentTree(content?.ast) ? content.ast : undefined

  return (
    <EditingSession
      key={documentId}
      documentId={documentId}
      frontMatter={content?.frontMatter ?? {}}
      workspaceSlug={workspaceSlug}
      title={document.data.title}
      initialAst={initialAst}
      draftVersion={draft.data.draftVersion}
      baseRevision={draft.data.baseRevision}
      permissions={envelope.data?.permissions}
      holderName={envelope.data?.lock?.holderName}
      store={recovery.store}
      hasRecovered={recovery.recovered !== undefined}
      onReloadDraft={() => {
        void draft.refetch()
      }}
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
  readonly draftVersion: number
  readonly baseRevision: string | null
  readonly permissions: DocumentPermissions | undefined
  readonly holderName: string | undefined
  readonly store: PersistentRecoveryStore
  readonly hasRecovered: boolean
  readonly onReloadDraft: () => void
}

function EditingSession({
  documentId,
  workspaceSlug,
  title,
  frontMatter,
  initialAst,
  draftVersion,
  baseRevision,
  permissions,
  holderName,
  store,
  hasRecovered,
  onReloadDraft,
}: EditingSessionProps) {
  const navigate = useNavigate()
  const styles = editorRouteStyles()

  const draftClient = useDraftClient(documentId)
  const lockClient = useLockClient(documentId)
  const lock = useDocumentLock({ client: lockClient })
  // The lock buttons start async work with no mutation hook behind it, so the
  // transition's pending flag is what puts the spinner on the button pressed
  // (docs/design/feedback.md).
  const [lockActionPending, startLockAction] = useTransition()
  const autosave = useAutosave({
    client: draftClient,
    store,
    documentVersion: draftVersion,
    canSave: lock.canAutosave,
  })
  useUnsavedChangesGuard(autosave.pending !== undefined)

  const editorRef = useRef<DocumentEditorHandle>(null)
  const publish = usePublishDocument()
  const [merge, setMerge] = useState<MergeRequired | undefined>(undefined)
  const [insertingImage, setInsertingImage] = useState(false)
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
  const lockLost = lock.status === 'lost' || autosave.status === 'blocked'
  const heldBy = holderName ?? lock.holder?.displayName
  const canEdit = permissions?.edit !== false && !lockedByOther && !lockLost
  /*
   * The notices region takes its space only when it has something in it. A
   * region that is always there puts a band of nothing above the document and
   * moves the whole surface off the rhythm the canvas sets.
   */
  const hasNotices =
    publish.error !== null ||
    hasRecovered ||
    lockedByOther ||
    lockLost ||
    autosave.status === 'stale' ||
    initialAst === undefined

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
    autosave.change(handle.toMdast())
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
        />
        <Button size="sm" loading={publish.isPending} disabled={!canEdit} onClick={handlePublish}>
          Publish
        </Button>
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

          {lockedByOther ? (
            <Block>
              <Callout
                tone="warning"
                title={`${heldBy ?? 'Someone else'} is editing this document`}
              >
                Autosave is off while someone else holds the lock, so nothing you type here will be
                saved. Your changes stay in this browser either way.
                {permissions?.manage === true ? (
                  <div className={styles.actionRow()}>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={lockActionPending}
                      onClick={() => {
                        startLockAction(() => lock.takeover())
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
                      startLockAction(() => lock.acquire())
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
                        startLockAction(() => lock.takeover())
                      }}
                    >
                      Take over
                    </Button>
                  ) : undefined}
                </div>
              </Callout>
            </Block>
          ) : undefined}

          {autosave.status === 'stale' ? (
            <Block>
              <Callout tone="warning" title="This draft changed somewhere else">
                Another tab or another session saved this draft after you opened it. Reload it and
                keep writing; your unsent change is still here.
                <div className={styles.actionRow()}>
                  <Button size="sm" variant="secondary" onClick={onReloadDraft}>
                    Reload the draft
                  </Button>
                </div>
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
          className={styles.surface()}
          onChange={(handle) => {
            autosave.change(handle.toMdast())
          }}
          onRequest={(request) => {
            if (request.kind !== 'image') return
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

      <ImageUrlDialog
        open={insertingImage}
        onOpenChange={setInsertingImage}
        onSubmit={(src) => {
          const editor = editorRef.current?.editor
          if (editor == null) return
          insertImage({ src })(editor.state, editor.view.dispatch)
        }}
      />
    </>
  )
}
