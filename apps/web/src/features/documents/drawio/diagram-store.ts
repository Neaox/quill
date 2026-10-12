import type { Attachment } from '@quill/api-client/upload'
import type { DrawioDiagram } from '@quill/editor/drawio'
import { isDrawioFilename } from '@quill/markdown/drawio'

import { diagramOf } from './drawio-files.ts'

/**
 * The draw.io diagrams a document carries, for the editor's image views
 * (ADR-043): which images get "Edit diagram", and the address each is drawn
 * from.
 *
 * An observer (`subscribe` returns the unsubscribe), because the editor's
 * image views are ProseMirror's, built once, and the answers change while
 * they live — the attachment list arrives, a diagram is saved. A diagram is
 * an attachment of this document named `.drawio.svg`, the convention draw.io,
 * VS Code and GitHub share.
 *
 * A diagram re-saved under the same address would be drawn from the browser's
 * cached copy (attachments are cached for five minutes), so once one has been
 * saved here it is drawn with its version in the query, which the server
 * ignores; the Markdown keeps the plain address.
 */
export interface DiagramStore {
  /** Whether the instance has a draw.io editor; until it says so, nothing is offered. */
  enabled(): boolean
  enable(enabled: boolean): void
  isDiagram(src: string): boolean
  displaySrc(src: string): string
  find(src: string): DrawioDiagram | undefined
  subscribe(listener: () => void): () => void
  /** The document's attachments, as the server last listed them. */
  replace(attachments: readonly Attachment[]): void
  /** A diagram just saved here, before the list catches up. */
  saved(diagram: DrawioDiagram): void
}

export function isDiagramAttachment(attachment: Attachment): boolean {
  return attachment.contentType === 'image/svg+xml' && isDrawioFilename(attachment.filename)
}

export function createDiagramStore(): DiagramStore {
  let diagrams = new Map<string, DrawioDiagram>()
  let editable = false
  /** Diagrams saved in this session, by address: drawn fresh at their version. */
  const fresh = new Map<string, number>()
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    enabled: () => editable,
    enable(enabled) {
      if (enabled === editable) return
      editable = enabled
      notify()
    },
    isDiagram: (src) => editable && diagrams.has(src),
    displaySrc: (src) => {
      const version = fresh.get(src)
      return version === undefined ? src : `${src}?v=${String(version)}`
    },
    find: (src) => diagrams.get(src),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    replace(attachments) {
      const next = new Map(
        attachments
          .filter(isDiagramAttachment)
          .map((attachment) => [attachment.url, diagramOf(attachment)]),
      )
      // A list older than a save made here does not take the save back.
      for (const [url, version] of fresh) {
        const listed = next.get(url)
        if (listed !== undefined && listed.version < version) next.set(url, { ...listed, version })
      }
      diagrams = next
      notify()
    },
    saved(diagram) {
      diagrams = new Map(diagrams).set(diagram.url, diagram)
      fresh.set(diagram.url, diagram.version)
      notify()
    },
  }
}
