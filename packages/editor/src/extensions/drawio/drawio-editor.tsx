import { useRef, useState } from 'react'

import { BRAND } from '@quill/brand'
import { drawioFilename, editableDrawioSource } from '@quill/markdown/drawio'
import { Button } from '@quill/ui'

import { EmbeddedEditorFrame } from '../../embedded-frame/embedded-editor-frame.tsx'
import { EmbeddedEditorPrompt } from '../../embedded-frame/embedded-editor-prompt.tsx'
import { useFrameChannel } from '../../embedded-frame/use-frame-channel.ts'
import { browserInflate } from './browser-inflate.ts'
import {
  DRAWIO_ALLOW,
  DRAWIO_CONFIGURATION,
  DRAWIO_SANDBOX,
  DrawioInbound,
  EMPTY_DIAGRAM,
  drawioCodec,
  drawioEditorUrl,
} from './drawio-protocol.ts'
import type { DrawioMessage } from './drawio-protocol.ts'
import type { DrawioSessionEvent, DrawioSessionState } from './drawio-session.ts'
import { drawioSessionReducer, initialDrawioSessionState } from './drawio-session.ts'

/**
 * Editing a draw.io diagram in the embedded editor (ADR-043): the draw.io
 * protocol adapter (`drawio-protocol.ts`) on the generic external editor
 * frame (`../../embedded-frame`), driven by the session machine
 * (`drawio-session.ts`).
 *
 * A save is draw.io's `save`, answered with an `export` of the diagram as a
 * `.drawio.svg`, which is then written: a new attachment for a new diagram, a
 * new revision of the attachment for an existing one — naming the version
 * that was opened, so a newer save by somebody else is a conflict to resolve
 * ("Save as copy" or "Reload"), never a silent overwrite. The image in the
 * document is the application's to insert or update (`onSaved`).
 *
 * The editor package makes no requests: the attachments API is the
 * application's, behind `DrawioFiles`.
 */

/** A diagram stored as an attachment, at the version this session knows. */
export interface DrawioDiagram {
  readonly attachmentId: string
  /** Where the document points at it. */
  readonly url: string
  readonly version: number
}

export type DrawioRevision =
  | { readonly kind: 'revised'; readonly diagram: DrawioDiagram }
  | { readonly kind: 'conflict'; readonly currentVersion: number }

/** The attachments API, as the draw.io session needs it. The application implements it. */
export interface DrawioFiles {
  /** The stored file's text, and the version it is. */
  read(diagram: DrawioDiagram): Promise<{ readonly file: string; readonly version: number }>
  /** A new attachment on the document being edited. */
  create(svg: string, filename: string): Promise<DrawioDiagram>
  /** A new revision of `diagram`, if it is still at `diagram.version`. */
  revise(diagram: DrawioDiagram, svg: string): Promise<DrawioRevision>
}

export type DrawioTarget =
  | { readonly kind: 'new'; readonly title: string }
  | { readonly kind: 'existing'; readonly diagram: DrawioDiagram; readonly title: string }

export interface DrawioSaved {
  /** `created` for a new diagram, `revised` in place, `copied` when a conflict was saved as a copy. */
  readonly kind: 'created' | 'revised' | 'copied'
  readonly diagram: DrawioDiagram
}

export interface DrawioEditorProps {
  /** The instance's draw.io editor page (`GET /api/extensions/drawio`). */
  readonly editorUrl: string
  /** The only origin its messages are accepted from. */
  readonly origin: string
  /** diagrams.net's hosted editor, which receives the diagram: the writer is told. */
  readonly thirdParty: boolean
  /** The reader's colour scheme, which the editor matches. */
  readonly dark: boolean
  readonly target: DrawioTarget
  readonly files: DrawioFiles
  onSaved(saved: DrawioSaved): void
  onClose(): void
  /** How long to wait for the editor to answer at all. */
  readonly timeoutMs?: number
}

const TITLE = 'Draw.io diagram'

/** Long enough for a cold editor on a slow line; past it, something is wrong. */
const EDITOR_TIMEOUT_MS = 30_000

function statusOf(state: DrawioSessionState, thirdParty: boolean): string {
  switch (state.status) {
    case 'loading':
      return 'Opening the diagram…'
    case 'saving':
      return 'Saving…'
    case 'saved':
      return 'Saved'
    case 'conflict':
      return 'Not saved: a newer version exists'
    case 'error':
      return state.retry === 'save' ? 'Not saved' : 'Not opened'
    case 'ready':
    case 'confirming-close':
    case 'closed':
      if (thirdParty) return 'Edited on diagrams.net, which receives this diagram'
      return state.status === 'ready' && state.dirty ? 'Unsaved changes' : ''
  }
}

export function DrawioEditor({
  editorUrl,
  origin,
  thirdParty,
  dark,
  target,
  files,
  onSaved,
  onClose,
  timeoutMs = EDITOR_TIMEOUT_MS,
}: DrawioEditorProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState<DrawioSessionState>(initialDrawioSessionState)
  // What the handlers below act on. They run on messages and clicks, never
  // while rendering, and each reads the session as the previous one left it.
  const session = useRef<DrawioSessionState>(initialDrawioSessionState)
  const diagram = useRef<DrawioDiagram | null>(target.kind === 'existing' ? target.diagram : null)
  const exported = useRef<string | null>(null)
  /** A save's labels were converted to SVG text and reloaded; the export follows the `load` answer. */
  const converting = useRef(false)
  const [src] = useState(() => drawioEditorUrl(editorUrl, { dark }))

  function transition(event: DrawioSessionEvent): DrawioSessionState {
    const next = drawioSessionReducer(session.current, event)
    session.current = next
    setState(next)
    if (next.status === 'closed') onClose()
    return next
  }

  const send = useFrameChannel({
    frameRef,
    origin,
    inbound: DrawioInbound,
    codec: drawioCodec,
    timeoutMs,
    onMessage: (message) => {
      void receive(message)
    },
    onSilent: () => {
      transition({
        type: 'failed',
        message: `The draw.io editor at ${origin} did not answer. Check that it is running.`,
        retry: 'none',
      })
    },
  })

  async function open(): Promise<void> {
    const current = diagram.current
    if (current === null) {
      send({ action: 'load', xml: EMPTY_DIAGRAM, autosave: 1, title: target.title })
      return
    }
    try {
      const { file, version } = await files.read(current)
      const source = await editableDrawioSource(file, browserInflate)
      if (source.kind !== 'source') {
        transition({
          type: 'failed',
          message: `This file holds no draw.io diagram ${BRAND.name} can open.`,
          retry: 'none',
        })
        return
      }
      diagram.current = { ...current, version }
      send({ action: 'load', xml: source.xml, autosave: 1, title: target.title })
    } catch {
      transition({ type: 'failed', message: 'The diagram could not be opened.', retry: 'open' })
    }
  }

  async function write(svg: string, copy: boolean): Promise<void> {
    const current = diagram.current
    try {
      if (current === null || copy) {
        const created = await files.create(svg, drawioFilename(target.title))
        diagram.current = created
        onSaved({ kind: current === null ? 'created' : 'copied', diagram: created })
        saved(created.version)
        return
      }
      const result = await files.revise(current, svg)
      if (result.kind === 'conflict') {
        transition({ type: 'conflicted', currentVersion: result.currentVersion })
        send({ action: 'status', modified: true, message: 'Not saved' })
        return
      }
      diagram.current = result.diagram
      onSaved({ kind: 'revised', diagram: result.diagram })
      saved(result.diagram.version)
    } catch {
      transition({ type: 'failed', message: 'The diagram could not be saved.', retry: 'save' })
      // draw.io cleared its own "modified" as it sent the save; it is not saved.
      send({ action: 'status', modified: true, message: 'Not saved' })
    }
  }

  function exportSvg(): void {
    send({ action: 'export', format: 'xmlsvg', asText: true, embedFonts: false, spinKey: 'saving' })
  }

  function saved(version: number): void {
    const next = transition({ type: 'saved', version })
    if (next.status !== 'closed') send({ action: 'status', modified: false, message: 'Saved' })
  }

  async function receive(message: DrawioMessage): Promise<void> {
    switch (message.event) {
      case 'configure':
        send({ action: 'configure', config: DRAWIO_CONFIGURATION })
        return
      case 'init':
        await open()
        return
      case 'load':
        if (converting.current) {
          converting.current = false
          exportSvg()
          return
        }
        transition({ type: 'loaded' })
        return
      case 'autosave':
        transition({ type: 'changed' })
        return
      case 'save': {
        if (
          transition({ type: 'save-requested', exit: message.exit === true }).status !== 'saving'
        ) {
          return
        }
        const source = await editableDrawioSource(message.xml, browserInflate)
        if (source.kind === 'source' && source.converted) {
          converting.current = true
          send({ action: 'load', xml: source.xml, autosave: 1, title: target.title })
        } else {
          exportSvg()
        }
        return
      }
      case 'export':
        send({ action: 'spinner', show: false })
        if (session.current.status !== 'saving') return
        exported.current = message.data
        await write(message.data, session.current.copy)
        return
      case 'exit':
        transition({ type: 'exited' })
        return
    }
  }

  function reload(): void {
    transition({ type: 'reload-requested' })
    void open()
  }

  const prompt = (() => {
    switch (state.status) {
      case 'conflict':
        return (
          <EmbeddedEditorPrompt
            title="Somebody saved a newer version"
            actions={
              <>
                <Button variant="secondary" onClick={() => reload()}>
                  Reload theirs
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    transition({ type: 'copy-requested' })
                    /* v8 ignore else -- a conflict is only ever raised by writing an export, so one is held. */
                    if (exported.current !== null) void write(exported.current, true)
                  }}
                >
                  Save mine as a copy
                </Button>
              </>
            }
          >
            <p>
              This diagram was saved by somebody else (version {state.currentVersion}) after you
              opened it. Your changes are not saved. Save yours as a new diagram in its place, or
              reload theirs and lose your changes.
            </p>
          </EmbeddedEditorPrompt>
        )
      case 'confirming-close':
        return (
          <EmbeddedEditorPrompt
            title="Close without saving?"
            actions={
              <>
                <Button variant="secondary" onClick={() => transition({ type: 'close-cancelled' })}>
                  Keep editing
                </Button>
                <Button variant="danger" onClick={() => transition({ type: 'close-confirmed' })}>
                  Discard changes
                </Button>
              </>
            }
          >
            <p>Your changes to this diagram have not been saved.</p>
          </EmbeddedEditorPrompt>
        )
      case 'error':
        return (
          <EmbeddedEditorPrompt
            title={
              state.retry === 'save' ? 'Your diagram is not saved' : 'The diagram did not open'
            }
            actions={
              <>
                <Button variant="secondary" onClick={() => transition({ type: 'close-requested' })}>
                  Close
                </Button>
                {state.retry === 'none' ? undefined : (
                  <Button variant="primary" onClick={retry}>
                    Try again
                  </Button>
                )}
              </>
            }
          >
            <p>{state.message}</p>
          </EmbeddedEditorPrompt>
        )
      default:
        return undefined
    }
  })()

  function retry(): void {
    const next = transition({ type: 'retried' })
    if (next.status === 'loading') {
      void open()
      return
    }
    /* v8 ignore else -- Try again is offered only after a failed open or a failed write, which leaves an export held. */
    if (next.status === 'saving' && exported.current !== null) {
      void write(exported.current, false)
    }
  }

  return (
    <EmbeddedEditorFrame
      title={TITLE}
      src={src}
      sandbox={DRAWIO_SANDBOX}
      allow={DRAWIO_ALLOW}
      frameRef={frameRef}
      status={statusOf(state, thirdParty)}
      onCloseRequest={() => transition({ type: 'close-requested' })}
    >
      {prompt}
    </EmbeddedEditorFrame>
  )
}
