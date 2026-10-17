import type { ApiClient } from '@quill/api-client'
import { reviseAttachment, uploadAttachment } from '@quill/api-client/upload'
import type { Attachment } from '@quill/api-client/upload'
import type { DrawioDiagram, DrawioFiles } from '@quill/editor/drawio'

import { toApiError } from '../../../lib/api/errors.ts'

/**
 * The attachments API as the draw.io session needs it (`DrawioFiles`,
 * ADR-043): read a diagram, save a new one, save a revision of one.
 *
 * The editor package makes no requests; this is the application's side of
 * that port. A revision names the version the session opened, and the
 * server's `409` is answered as a conflict, carrying the version that won,
 * for the session to offer "Save as copy" or "Reload".
 */

const SVG = 'image/svg+xml'

export function diagramOf(attachment: Attachment): DrawioDiagram {
  return { attachmentId: attachment.id, url: attachment.url, version: attachment.version }
}

function currentVersion(details: unknown): number | null {
  if (typeof details !== 'object' || details === null || !('current' in details)) return null
  const { current } = details
  if (typeof current !== 'object' || current === null || !('version' in current)) return null
  return typeof current.version === 'number' ? current.version : null
}

export interface DrawioFilesOptions {
  readonly client: ApiClient
  readonly documentId: string
  /** The version the document's attachment list says a diagram is at. */
  versionOf(attachmentId: string): Promise<number>
  /** Called after any write, so the document's attachment list is read again. */
  onWritten(): void
  readonly fetch?: typeof fetch
}

export function createDrawioFiles(options: DrawioFilesOptions): DrawioFiles {
  const fetchFile = options.fetch ?? fetch
  return {
    async read(diagram) {
      // Fresh, not from the cache: the editor must open the newest revision.
      const [response, version] = await Promise.all([
        fetchFile(diagram.url, { cache: 'no-cache', credentials: 'same-origin' }),
        options.versionOf(diagram.attachmentId),
      ])
      if (!response.ok)
        throw new Error(`The diagram could not be read (${String(response.status)}).`)
      return { file: await response.text(), version }
    },

    async create(svg, filename) {
      const file = new Blob([svg], { type: SVG })
      const { data, error, response } = await uploadAttachment(options.client, {
        documentId: options.documentId,
        file,
        filename,
      })
      if (!response.ok || data === undefined) throw toApiError(response.status, error)
      options.onWritten()
      return diagramOf(data)
    },

    async revise(diagram, svg) {
      const { data, error, response } = await reviseAttachment(options.client, {
        attachmentId: diagram.attachmentId,
        expectedVersion: diagram.version,
        file: new Blob([svg], { type: SVG }),
        filename: 'diagram.drawio.svg',
      })
      if (response.status === 403) {
        const refusal = toApiError(response.status, error)
        // Saving again would be refused again; the editor offers a copy instead.
        if (refusal.code === 'publish_required')
          return { kind: 'refused', message: refusal.message }
        throw refusal
      }
      if (response.status === 409) {
        const failure = toApiError(response.status, error)
        const version = currentVersion(failure.details)
        if (version !== null) return { kind: 'conflict', currentVersion: version }
        throw failure
      }
      if (!response.ok || data === undefined) throw toApiError(response.status, error)
      options.onWritten()
      return { kind: 'revised', diagram: diagramOf(data) }
    },
  }
}
