import type { DocumentId, UserId } from '@quill/domain'

import { concatChunks, type BlobStore } from '../ports/blob-store.ts'
import type { AttachmentId, AttachmentRow, DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { MalformedImage, stripImageMetadata } from './image-metadata.ts'
import {
  isAllowedMediaType,
  isImageMediaType,
  isInlineMediaType,
  normaliseMediaType,
  SNIFF_BYTES,
  sniffMediaType,
} from './media-types.ts'
import type { AllowedMediaType, ImageMediaType } from './media-types.ts'

/**
 * Attachments: uploading one, serving one, and taking one down (ADR-011
 * uploads, ADR-034 the blob store as a system of record, plan §11).
 *
 * An attachment is a row in Postgres pointing at bytes in the blob store, and
 * the two say different things: the row is who uploaded what, to which
 * document, under what name; the object is the bytes, addressed by their own
 * SHA-256 and shared by every attachment that happens to be the same picture.
 * Which is why a delete here is a delete of the row and never of the object.
 *
 * Nothing in this module trusts the caller about content. The declared type is
 * checked against the bytes, the size is counted as the bytes arrive rather
 * than read from a header, the name is only ever a label, and a picture is
 * stored without what it carried besides its pixels (`image-metadata.ts`).
 */

/** Where a reader fetches an attachment. The renderer, the sanitiser, and the editor all agree on this shape. */
export function attachmentUrl(id: AttachmentId): string {
  return `/api/attachments/${id}`
}

/**
 * The URL an attachment occupies in the link index.
 *
 * TODO(M4): export rewrites these to a path inside the exported bundle, and
 * import maps them back, so an exported document is self-contained
 * (quill-plan.md section 24). The renderer emits the relative form precisely
 * so that rewrite is a string substitution rather than a re-render.
 */
export const ATTACHMENT_URL_PREFIX = '/api/attachments/'

export const ATTACHMENT_AUDIT_EVENTS = {
  uploaded: 'attachment.uploaded',
  deleted: 'attachment.deleted',
} as const

export interface AttachmentDependencies {
  readonly uow: UnitOfWork
  readonly blobStore: BlobStore
  readonly clock: Clock
  readonly ids: IdGenerator
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface UploadAttachmentCommand {
  readonly documentId: DocumentId
  readonly uploadedBy: UserId
  /** What the uploader called the file. Sanitised here; never used as a path. */
  readonly filename: string
  /** What the uploader said it was. Checked against the bytes, never believed. */
  readonly declaredContentType: string
  readonly body: AsyncIterable<Uint8Array>
  /** The cap, from configuration. Counted as the bytes arrive. */
  readonly maxBytes: number
}

export type UploadAttachmentResult =
  | { readonly kind: 'uploaded'; readonly attachment: AttachmentRow; readonly url: string }
  | { readonly kind: 'document-not-found'; readonly documentId: DocumentId }
  /** More bytes than the cap allows. The upload is abandoned at the byte that crossed it. */
  | { readonly kind: 'too-large'; readonly maxBytes: number }
  /** An empty file: nothing to sniff, nothing worth storing. */
  | { readonly kind: 'empty' }
  /** The bytes are a type this platform does not accept; `sniffed` is what they are. */
  | { readonly kind: 'type-not-allowed'; readonly sniffed: string | null }
  /** The bytes are allowed, but are not what the request said they were. */
  | {
      readonly kind: 'type-mismatch'
      readonly declared: string
      readonly sniffed: string
    }
  /**
   * A picture whose container could not be walked — cut short, framed
   * wrongly, pointing outside itself — so its metadata could not be removed,
   * and so it is not stored. `reason` says what was wrong, in the words of
   * the walker that stopped.
   */
  | { readonly kind: 'malformed'; readonly contentType: ImageMediaType; readonly reason: string }

/**
 * A file becomes an attachment.
 *
 * The body is consumed once, as a stream: the first chunks are held only until
 * there are enough bytes to sniff, the running total is checked against the
 * cap on every chunk, and the rest is handed straight to the store. So an
 * oversized upload is refused after the byte that crossed the cap rather than
 * after the last one, and a `.exe` renamed `.png` is refused before its bytes
 * are worth storing.
 *
 * The caller has already decided the uploader may `edit` this document; this
 * checks that the document exists and that the file is one the platform will
 * serve.
 */
export async function uploadAttachment(
  deps: AttachmentDependencies,
  command: UploadAttachmentCommand,
): Promise<UploadAttachmentResult> {
  const document = await deps.uow.repos.documents.findById(command.documentId)
  if (document === null) return { kind: 'document-not-found', documentId: command.documentId }

  const rest = capped(command.body, command.maxBytes)

  let head: Uint8Array
  try {
    head = await readHead(rest)
  } catch (error) {
    return refusal(error)
  }
  if (head.length === 0) return { kind: 'empty' }

  const decided = decide(head, command.declaredContentType)
  if (decided.kind !== 'allowed') return decided

  // The type is known before a byte reaches the store, so the store is told
  // what it is holding rather than what the request claimed; and the metadata
  // walk happens before the hash, so the address is the address of the bytes
  // this platform will actually serve — two uploads of the same photograph,
  // one carrying its coordinates and one not, are one object.
  const whole = join(head, rest)
  const bytes = isImageMediaType(decided.type) ? stripImageMetadata(decided.type, whole) : whole

  let blob
  try {
    blob = await deps.blobStore.put(bytes, decided.type)
  } catch (error) {
    // The cap is counted as the bytes arrive and the container is walked as
    // they pass, so either can still refuse long after the head was read —
    // which means it refuses inside the store's own `put`, and comes back out
    // here.
    return refusal(error)
  }

  return store(deps, command, document, blob.hash, blob.size, decided.type)
}

/** Enough of the body to sniff, or all of it when there is less than that. */
async function readHead(chunks: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
  const head: Uint8Array[] = []
  let length = 0
  while (length < SNIFF_BYTES) {
    const { done, value } = await chunks.next()
    if (done === true) break
    head.push(value)
    length += value.length
  }
  return concatChunks(head)
}

/** The head, then the rest of the body it was read from. */
async function* join(
  head: Uint8Array,
  rest: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  yield head
  yield* rest
}

/**
 * The body, refused the moment it passes the cap.
 *
 * Counted here rather than read from a header, and checked on every chunk, so
 * an upload is abandoned at the byte that crossed the limit instead of after
 * the last one somebody chose to send.
 */
async function* capped(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): AsyncGenerator<Uint8Array> {
  let total = 0
  for await (const chunk of body) {
    total += chunk.length
    if (total > maxBytes) throw new UploadRefused({ kind: 'too-large', maxBytes })
    yield chunk
  }
}

type Decision =
  | { readonly kind: 'allowed'; readonly type: AllowedMediaType }
  | Extract<UploadAttachmentResult, { kind: 'type-not-allowed' } | { kind: 'type-mismatch' }>

/** What these bytes are, or a refusal naming why they are not acceptable. */
function decide(head: Uint8Array, declaredContentType: string): Decision {
  // `sniffMediaType` names an SVG rather than shrugging at one, so a refusal
  // can tell an author that this is about SVG's own capabilities rather than
  // leaving them to wonder why a picture was not a picture.
  const sniffed = sniffMediaType(head)
  if (sniffed === null || !isAllowedMediaType(sniffed)) {
    return { kind: 'type-not-allowed', sniffed }
  }
  const declared = normaliseMediaType(declaredContentType)
  if (declared !== sniffed) return { kind: 'type-mismatch', declared, sniffed }
  return { kind: 'allowed', type: sniffed }
}

/**
 * The size cap's refusal, travelling out through whatever is consuming the
 * stream — the metadata walk, then the store's `put` — neither of which speaks
 * anything but exceptions. It is caught the moment it comes back out.
 */
class UploadRefused extends Error {
  readonly result: UploadAttachmentResult

  constructor(result: UploadAttachmentResult) {
    super('upload refused')
    this.name = 'UploadRefused'
    this.result = result
  }
}

/**
 * A refusal, or the error as it was: a connection that went away is not a
 * refusal, and must not be reported as one.
 *
 * Two things refuse from inside a stream somebody else is consuming — the size
 * cap, which throws its own result, and the container walkers, which throw
 * `MalformedImage` — so both are recognised here and nothing else is.
 */
function refusal(error: unknown): UploadAttachmentResult {
  if (error instanceof UploadRefused) return error.result
  if (error instanceof MalformedImage) {
    return { kind: 'malformed', contentType: error.contentType, reason: error.reason }
  }
  throw error
}

/** The row, its audit entry, and nothing else: the bytes are already in the store. */
async function store(
  deps: AttachmentDependencies,
  command: UploadAttachmentCommand,
  document: DocumentRow,
  sha256: string,
  size: number,
  contentType: string,
): Promise<UploadAttachmentResult> {
  const now = deps.clock.now()
  const id = deps.ids.uuid()
  const attachment = await deps.uow.run(async (tx) => {
    const row = await tx.attachments.create({
      id,
      documentId: document.id,
      workspaceId: document.workspaceId,
      uploadedBy: command.uploadedBy,
      filename: safeFilename(command.filename),
      contentType,
      size,
      sha256,
      now,
    })
    await tx.audit.write({
      id: deps.ids.uuid(),
      type: ATTACHMENT_AUDIT_EVENTS.uploaded,
      actorUserId: command.uploadedBy,
      targetType: 'attachment',
      targetId: id,
      metadata: { documentId: document.id, contentType, size, sha256 },
      now,
    })
    return row
  })
  return { kind: 'uploaded', attachment, url: attachmentUrl(attachment.id) }
}

/** How long a name may be before it stops being a label and starts being a payload. */
const MAX_FILENAME_LENGTH = 200

/** C0 and DEL: a name that carries a newline can forge a header line. */
const CONTROL_CHARACTERS = /\p{Cc}/gu

/**
 * A filename reduced to a label.
 *
 * It is never a path — the object's address is its hash — so every directory
 * separator, every control character, and every leading dot is removed rather
 * than escaped. What survives is what a `Content-Disposition` and a list can
 * show, and a name that survives to nothing becomes one the platform chose.
 */
export function safeFilename(raw: string): string {
  const flattened = raw
    .replaceAll(CONTROL_CHARACTERS, '')
    .replaceAll(/[/\\]/gu, '-')
    .replaceAll(/^[.\s-]+/gu, '')
    .trim()
  const bounded = truncateCodePoints(flattened, MAX_FILENAME_LENGTH)
  return bounded === '' ? 'attachment' : bounded
}

/**
 * The first `limit` code points, never half of one.
 *
 * `String.prototype.slice` counts UTF-16 units, so cutting at a fixed index can
 * land between the halves of a surrogate pair and leave a lone surrogate — a
 * character that is not a character, which `encodeURIComponent` refuses
 * outright and which a `Content-Disposition` header would carry as a
 * replacement glyph. Iterating a string yields whole code points, which is what
 * a name is made of.
 */
export function truncateCodePoints(value: string, limit: number): string {
  const points = [...value]
  return points.length <= limit ? value : points.slice(0, limit).join('')
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface GetAttachmentCommand {
  readonly attachmentId: AttachmentId
}

export interface ServedAttachment {
  readonly kind: 'found'
  readonly attachment: AttachmentRow
  readonly body: AsyncIterable<Uint8Array>
  /** `inline` for a picture, `attachment` for everything else (ADR-011). */
  readonly disposition: 'inline' | 'attachment'
}

export type GetAttachmentResult =
  | ServedAttachment
  | { readonly kind: 'not-found'; readonly attachmentId: AttachmentId }
  /**
   * The row is there and the object is not. It answers as a miss rather than
   * as a fault, because to a reader it is the same thing, and the alternative
   * is telling them the platform is broken when the answer is that this file
   * is gone.
   */
  | { readonly kind: 'blob-missing'; readonly attachmentId: AttachmentId }

/**
 * An attachment, ready to serve.
 *
 * The caller has already decided the request may `view` the document that owns
 * it — which is the only thing that governs an attachment's visibility, so
 * there is no second answer here for a share link or the public principal to
 * disagree with when they arrive (ADR-012).
 *
 * A soft-deleted attachment is gone: a body that still names one is a stale
 * revision, and serving it would make "deleted" mean nothing.
 */
export async function getAttachment(
  deps: AttachmentDependencies,
  command: GetAttachmentCommand,
): Promise<GetAttachmentResult> {
  const attachment = await deps.uow.repos.attachments.findById(command.attachmentId)
  if (attachment === null || attachment.deletedAt !== null) {
    return { kind: 'not-found', attachmentId: command.attachmentId }
  }
  const body = await deps.blobStore.open(attachment.sha256)
  if (body === null) return { kind: 'blob-missing', attachmentId: command.attachmentId }
  return {
    kind: 'found',
    attachment,
    body,
    disposition: isInlineMediaType(attachment.contentType) ? 'inline' : 'attachment',
  }
}

/** Everything this document carries, for the panel, the editor, and later for export. */
export async function listAttachments(
  deps: AttachmentDependencies,
  documentId: DocumentId,
): Promise<readonly AttachmentRow[]> {
  return deps.uow.repos.attachments.listForDocument(documentId)
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export interface DeleteAttachmentCommand {
  readonly attachmentId: AttachmentId
  readonly deletedBy: UserId
}

export type DeleteAttachmentResult =
  | { readonly kind: 'deleted'; readonly attachment: AttachmentRow }
  | { readonly kind: 'not-found'; readonly attachmentId: AttachmentId }
  /**
   * A published body still points at it, and taking it away would put a broken
   * picture in a document somebody is reading. The documents are named so the
   * refusal can be acted on rather than only understood.
   */
  | { readonly kind: 'in-use'; readonly documents: readonly DocumentId[] }

/**
 * Takes an attachment down.
 *
 * The row is marked deleted and the object is left alone. Two reasons, and
 * both matter: the bytes are addressed by their hash, so another attachment —
 * another document's, even another workspace's — may be exactly the same
 * picture and still need them; and the blob store is a system of record
 * (ADR-034), from which a restore is expected to yield every attachment a
 * revision ever referenced.
 *
 * The refusal is decided from the link index, which holds the links of
 * published heads (`render-document.ts`). So "no published document shows
 * this" is exactly the question it can answer, and it is asked before anything
 * is written.
 */
export async function deleteAttachment(
  deps: AttachmentDependencies,
  command: DeleteAttachmentCommand,
): Promise<DeleteAttachmentResult> {
  const { repos } = deps.uow
  const attachment = await repos.attachments.findById(command.attachmentId)
  if (attachment === null || attachment.deletedAt !== null) {
    return { kind: 'not-found', attachmentId: command.attachmentId }
  }

  const referencing = await repos.documentLinks.listSourcesReferencing(
    attachmentUrl(attachment.id),
    attachment.workspaceId,
  )
  if (referencing.length > 0) return { kind: 'in-use', documents: referencing }

  const now = deps.clock.now()
  await deps.uow.run(async (tx) => {
    await tx.attachments.softDelete(attachment.id, now)
    await tx.audit.write({
      id: deps.ids.uuid(),
      type: ATTACHMENT_AUDIT_EVENTS.deleted,
      actorUserId: command.deletedBy,
      targetType: 'attachment',
      targetId: attachment.id,
      metadata: { documentId: attachment.documentId, sha256: attachment.sha256 },
      now,
    })
  })
  return { kind: 'deleted', attachment: { ...attachment, deletedAt: now } }
}
