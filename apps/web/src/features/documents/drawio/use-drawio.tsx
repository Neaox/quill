import { useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import {
  drawioImageAction,
  drawioSlashContribution,
  insertImage,
  setImageSource,
} from '@quill/editor'
import type { DocumentEditorHandle, ImageAction, SlashContribution } from '@quill/editor'
import type { DrawioSaved, DrawioTarget } from '@quill/editor/drawio'

import { useAttachments } from '../../../lib/api/attachments.ts'
import { useApiClient } from '../../../lib/api/client-context.tsx'
import { request } from '../../../lib/api/http.ts'
import { queryKeys } from '../../../lib/api/query-keys.ts'
import { createDiagramStore } from './diagram-store.ts'
import { createDrawioFiles } from './drawio-files.ts'
import { DescribeDiagramDialog } from './describe-diagram-dialog.tsx'

/**
 * draw.io in the document editor (ADR-043): the application's half of the
 * extension's editor binding.
 *
 * It offers "Draw.io diagram" in the slash menu and "Edit diagram" on the
 * document's diagrams, opens the draw.io session when either is chosen, and
 * puts what was saved into the document: a new diagram as an image at the
 * caret, a revision in place — the address does not change, so the document
 * does not either — and a copy, saved over a conflict, as the image's new
 * address. The session itself is `@quill/editor/drawio`, loaded only when it
 * is opened, so an editor that never draws a diagram never pays for it.
 *
 * An instance with no draw.io editor offers neither entry point; diagrams
 * still read, they cannot be edited here.
 */

const DrawioEditor = lazy(async () => {
  const module = await import('@quill/editor/drawio')
  return { default: module.DrawioEditor }
})

type Editor = NonNullable<DocumentEditorHandle['editor']>

export interface UseDrawioOptions {
  readonly documentId: string
  /** Runs a change against the live editor and queues the save any edit queues. */
  place(change: (editor: Editor) => void): void
}

export interface DrawioIntegration {
  readonly slashContributions: readonly SlashContribution[]
  readonly imageActions: readonly ImageAction[]
  /** The describe dialog and the editor session, when open. */
  readonly element: ReactNode
}

/** An open session: what it edits, and where its image is when it has one. */
type Session = DrawioTarget & { readonly pos?: number }

/** The reader's scheme as the page resolved it: the theme sets `color-scheme` on the root. */
function readerPrefersDark(): boolean {
  return getComputedStyle(document.documentElement).colorScheme.split(' ').at(0) === 'dark'
}

export function useDrawioEditorConfig() {
  const client = useApiClient()
  return useQuery({
    queryKey: queryKeys.drawioEditor(),
    queryFn: async () => (await request(client.GET('/api/extensions/drawio'))).editor,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useDrawio({ documentId, place }: UseDrawioOptions): DrawioIntegration {
  const client = useApiClient()
  const queryClient = useQueryClient()
  const config = useDrawioEditorConfig()
  const attachments = useAttachments(documentId)
  const [store] = useState(createDiagramStore)
  const [describing, setDescribing] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [dark, setDark] = useState(false)

  const drawioEditor = config.data ?? null

  // Synchronises the diagram store — an external store the editor's
  // ProseMirror image views subscribe to, which outlive renders — with the
  // document's attachment list as the server last gave it.
  useEffect(() => {
    if (attachments.data !== undefined) store.replace(attachments.data)
  }, [attachments.data, store])
  // Synchronises the same store with whether the instance has a draw.io
  // editor, which the slash menu, built once, asks each time it opens.
  useEffect(() => {
    store.enable(drawioEditor !== null)
  }, [drawioEditor, store])

  const files = useMemo(
    () =>
      createDrawioFiles({
        client,
        documentId,
        versionOf: async (attachmentId) => {
          const listed = await queryClient.fetchQuery({
            queryKey: queryKeys.attachments(documentId),
            queryFn: async () =>
              (
                await request(
                  client.GET('/api/documents/{id}/attachments', {
                    params: { path: { id: documentId } },
                  }),
                )
              ).attachments,
            staleTime: 0,
          })
          const found = listed.find((attachment) => attachment.id === attachmentId)
          if (found === undefined) throw new Error('That diagram is no longer attached here.')
          return found.version
        },
        onWritten: () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.attachments(documentId) })
        },
      }),
    [client, documentId, queryClient],
  )

  // Built once, as the editor reads them once; whether they are offered is
  // the store's to say, and they act through state setters, which never change.
  const slashContributions = useMemo(
    () => [
      drawioSlashContribution({ onInsert: () => setDescribing(true), enabled: store.enabled }),
    ],
    [store],
  )
  const imageActions = useMemo(
    () => [
      drawioImageAction({
        isDiagram: store.isDiagram,
        displaySrc: store.displaySrc,
        subscribe: store.subscribe,
        onEdit: (image) => {
          const diagram = store.find(image.src)
          if (diagram === undefined) return
          setDark(readerPrefersDark())
          setSession({ kind: 'existing', diagram, title: image.alt ?? 'Diagram', pos: image.pos })
        },
      }),
    ],
    [store],
  )

  function saved(result: DrawioSaved, current: Session): void {
    store.saved(result.diagram)
    if (result.kind === 'created') {
      const { url } = result.diagram
      place((editor) =>
        insertImage({ src: url, alt: current.title })(editor.state, editor.view.dispatch),
      )
      // Every later save from this session revises what it just created.
      setSession({ kind: 'existing', diagram: result.diagram, title: current.title })
      return
    }
    if (result.kind === 'copied' && current.kind === 'existing') {
      const replaced = current.diagram.url
      place((editor) => {
        const position = imagePosition(editor, replaced, current.pos)
        if (position === undefined) return
        setImageSource(position, result.diagram.url)(editor.state, editor.view.dispatch)
      })
      setSession({ kind: 'existing', diagram: result.diagram, title: current.title })
    }
  }

  const element = (
    <>
      <DescribeDiagramDialog
        open={describing}
        onCancel={() => setDescribing(false)}
        onSubmit={(title) => {
          setDescribing(false)
          setDark(readerPrefersDark())
          setSession({ kind: 'new', title })
        }}
      />
      {session === null || drawioEditor === null ? undefined : (
        <Suspense fallback={undefined}>
          <DrawioEditor
            editorUrl={drawioEditor.url}
            origin={drawioEditor.origin}
            thirdParty={drawioEditor.thirdParty}
            dark={dark}
            target={session}
            files={files}
            onSaved={(result) => saved(result, session)}
            onClose={() => setSession(null)}
          />
        </Suspense>
      )}
    </>
  )

  return { slashContributions, imageActions, element }
}

/**
 * Where the image showing `src` is: at `hint` when it still is, otherwise the
 * first image with that address — the session's image after an insertion,
 * whose position was never known, or after the document moved around it.
 */
function imagePosition(editor: Editor, src: string, hint: number | undefined): number | undefined {
  const { doc } = editor.state
  const at = hint === undefined || hint >= doc.content.size ? null : doc.nodeAt(hint)
  if (at !== null && at.type.name === 'image' && at.attrs['src'] === src) return hint
  let found: number | undefined
  doc.descendants((node, pos) => {
    if (found !== undefined) return false
    if (node.type.name === 'image' && node.attrs['src'] === src) found = pos
    return true
  })
  return found
}
