import type { DocumentId, UserId } from '@quill/domain'

import { concatChunks, type BlobStore } from '../ports/blob-store.ts'
import type { DrawingText } from '../ports/drawing-text.ts'
import type { AttachmentId, AttachmentRow, DocumentRow, UnitOfWork } from '../ports/persistence.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { attachmentRevised } from './events.ts'
import { MalformedImage, stripImageMetadata } from './image-metadata.ts'
import {
  DIAGRAM_SOURCE_MEDIA_TYPE,
  DRAWING_MEDIA_TYPE,
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

const ATTACHMENT_REFERENCE =
  /\/api\/attachments\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/giu

/**
 * The attachments a body names, by id, each once, in the order first named.
 * The renderer reads the drawings among them and search reads their words, so
 * both find them the same way, in one pass over the Markdown.
 */
export function attachmentIdsIn(markdown: string): readonly AttachmentId[] {
  if (!markdown.includes(ATTACHMENT_URL_PREFIX)) return []
  return [
    ...new Set(
      Array.from(markdown.matchAll(ATTACHMENT_REFERENCE), ([reference]) =>
        reference.slice(ATTACHMENT_URL_PREFIX.length).toLowerCase(),
      ),
    ),
  ]
}

export const ATTACHMENT_AUDIT_EVENTS = {
  uploaded: 'attachment.uploaded',
  revised: 'attachment.revised',
  deleted: 'attachment.deleted',
} as const

export interface AttachmentDependencies {
  readonly uow: UnitOfWork
  readonly blobStore: BlobStore
  readonly clock: Clock
  readonly ids: IdGenerator
  /** Reads a drawing's words for search, on upload and on each revision (ADR-043). */
  readonly drawingText: DrawingText
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

/** Why a file's bytes were not accepted, whether they came as an upload or as a revision. */
export type AttachmentRefusal = Extract<
  UploadAttachmentResult,
  { kind: 'too-large' | 'empty' | 'type-not-allowed' | 'type-mismatch' | 'malformed' }
>

/** A file's bytes, accepted and in the blob store. */
interface Received {
  readonly kind: 'received'
  readonly contentType: AllowedMediaType
  readonly sha256: string
  readonly size: number
  readonly searchText: string | null
}

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

  const received = await receive(deps, command)
  if (received.kind !== 'received') return received
  return store(deps, command, document, received)
}

/** The parts of a command that carry a file's bytes. */
interface IncomingFile {
  /** What the sender said it was. Checked against the bytes, never believed. */
  readonly declaredContentType: string
  readonly body: AsyncIterable<Uint8Array>
  /** The cap, from configuration. Counted as the bytes arrive. */
  readonly maxBytes: number
}

/**
 * A file's bytes, checked, stored, and read for words: the intake an upload
 * and a revision share, so a revision is held to exactly what an upload is.
 */
async function receive(
  deps: AttachmentDependencies,
  file: IncomingFile,
): Promise<Received | AttachmentRefusal> {
  const rest = capped(file.body, file.maxBytes)

  let head: Uint8Array
  try {
    head = await readHead(rest)
  } catch (error) {
    return refusal(error)
  }
  if (head.length === 0) return { kind: 'empty' }

  const decided = decide(head, file.declaredContentType)
  if (decided.kind !== 'allowed') return decided

  // The type is known before a byte reaches the store, so the store is told
  // what it is holding rather than what the request claimed; and the metadata
  // walk happens before the hash, so the address is the address of the bytes
  // this platform will actually serve — two uploads of the same photograph,
  // one carrying its coordinates and one not, are one object.
  const whole = join(head, rest)
  const kept: Uint8Array[] = []
  const bytes = isImageMediaType(decided.type)
    ? stripImageMetadata(decided.type, whole)
    : hasWords(decided.type)
      ? keeping(whole, kept)
      : whole

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

  const searchText = hasWords(decided.type)
    ? await deps.drawingText.read(
        new TextDecoder('utf-8', { fatal: false }).decode(concatChunks(kept)),
      )
    : null
  return {
    kind: 'received',
    contentType: decided.type,
    sha256: blob.hash,
    size: blob.size,
    searchText,
  }
}

/**
 * The types whose words are worth reading for search: drawings, whose labels
 * a reader sees but the Markdown does not say (ADR-043). Both are text held
 * under the upload cap, so keeping a copy while they stream is bounded.
 */
function hasWords(type: AllowedMediaType): boolean {
  return type === DRAWING_MEDIA_TYPE || type === DIAGRAM_SOURCE_MEDIA_TYPE
}

/** The stream as it was, each chunk also kept for a reader once the store has it. */
async function* keeping(
  chunks: AsyncIterable<Uint8Array>,
  kept: Uint8Array[],
): AsyncGenerator<Uint8Array> {
  for await (const chunk of chunks) {
    kept.push(chunk)
    yield chunk
  }
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
  readonly result: AttachmentRefusal

  constructor(result: AttachmentRefusal) {
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
function refusal(error: unknown): AttachmentRefusal {
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
  received: Received,
): Promise<UploadAttachmentResult> {
  const { contentType, size, sha256, searchText } = received
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
      searchText,
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

// ---------------------------------------------------------------------------
// Revise
// ---------------------------------------------------------------------------

/**
 * The documents whose published heads show this attachment, from the link
 * index (`render-document.ts`), in its own workspace. A revision changes what
 * each of their readers sees without a publish, so saving one asks of the
 * writer what publishing each of them would (ADR-043, amendment of
 * 2026-10-18). An empty answer means only drafts use it.
 */
export async function documentsShowingAttachment(
  deps: Pick<AttachmentDependencies, 'uow'>,
  attachment: Pick<AttachmentRow, 'id' | 'workspaceId'>,
): Promise<readonly DocumentId[]> {
  return deps.uow.repos.documentLinks.listSourcesReferencing(
    attachmentUrl(attachment.id),
    attachment.workspaceId,
  )
}

export interface ReviseAttachmentCommand extends IncomingFile {
  readonly attachmentId: AttachmentId
  readonly revisedBy: UserId
  /** The version the writer edited (ADR-043, "Concurrency"). */
  readonly expectedVersion: number
}

export type ReviseAttachmentResult =
  | { readonly kind: 'revised'; readonly attachment: AttachmentRow; readonly url: string }
  | { readonly kind: 'not-found'; readonly attachmentId: AttachmentId }
  /**
   * Somebody saved a newer revision since this writer opened theirs. Nothing
   * is written: the writer chooses to save theirs as a copy or to reload, and
   * is never silently overwritten, or overwriting.
   */
  | { readonly kind: 'version-conflict'; readonly current: AttachmentRow }
  /** A revision keeps its kind: a drawing stays a drawing, so the documents showing it still can. */
  | { readonly kind: 'type-changed'; readonly current: string; readonly sniffed: string }
  | AttachmentRefusal

/**
 * A new revision of an attachment, under the same id and URL (ADR-043).
 *
 * Every document that shows the attachment shows the revision, and none of
 * them gets a revision of its own: the attachment carries its own history,
 * one row per version it replaced. The version is a compare-and-set, checked
 * before the bytes are read and again where the row is written, so two
 * writers saving at once cannot both win.
 *
 * The caller has already decided the writer may `edit` the owning document,
 * and, when a published page shows the attachment, `publish` on the owner
 * and on every such page (`documentsShowingAttachment`): a revision reaches
 * those pages' readers at once, as a publish would.
 */
export async function reviseAttachment(
  deps: AttachmentDependencies,
  command: ReviseAttachmentCommand,
): Promise<ReviseAttachmentResult> {
  const current = await deps.uow.repos.attachments.findById(command.attachmentId)
  if (current === null || current.deletedAt !== null) {
    return { kind: 'not-found', attachmentId: command.attachmentId }
  }
  if (current.version !== command.expectedVersion) return { kind: 'version-conflict', current }

  const received = await receive(deps, command)
  if (received.kind !== 'received') return received
  if (received.contentType !== current.contentType) {
    return { kind: 'type-changed', current: current.contentType, sniffed: received.contentType }
  }

  const now = deps.clock.now()
  const revised = await deps.uow.run(async (tx) => {
    const row = await tx.attachments.revise({
      id: current.id,
      expectedVersion: command.expectedVersion,
      revisedBy: command.revisedBy,
      contentType: received.contentType,
      size: received.size,
      sha256: received.sha256,
      searchText: received.searchText,
      now,
    })
    if (row === null) return null
    await tx.audit.write({
      id: deps.ids.uuid(),
      type: ATTACHMENT_AUDIT_EVENTS.revised,
      actorUserId: command.revisedBy,
      targetType: 'attachment',
      targetId: row.id,
      metadata: {
        documentId: row.documentId,
        version: row.version,
        size: row.size,
        sha256: row.sha256,
      },
      now,
    })
    await tx.events.record(
      attachmentRevised,
      {
        attachmentId: row.id,
        documentId: row.documentId,
        workspaceId: row.workspaceId,
        attachmentVersion: row.version,
      },
      now,
    )
    return row
  })

  if (revised !== null) {
    return { kind: 'revised', attachment: revised, url: attachmentUrl(revised.id) }
  }
  // Lost the race between the check above and the write: answer with what won.
  const winner = await deps.uow.repos.attachments.findById(command.attachmentId)
  return winner === null || winner.deletedAt !== null
    ? { kind: 'not-found', attachmentId: command.attachmentId }
    : { kind: 'version-conflict', current: winner }
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

  const referencing = await documentsShowingAttachment(deps, attachment)
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
