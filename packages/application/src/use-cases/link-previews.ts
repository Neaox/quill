import {
  LINK_PREVIEW_FAILURES,
  LINK_PREVIEW_KINDS,
  LINK_PREVIEW_LAYERS,
  PREVIEW_TONES,
  err,
  isStale,
  normaliseUrl,
  ok,
  retryAfter,
  userId as toUserId,
} from '@quill/domain'
import type {
  LinkPreview,
  LinkPreviewFailure,
  LinkPreviewKind,
  LinkPreviewLayer,
  LinkPreviewView,
  PreviewImage,
  Result,
  UserId,
} from '@quill/domain'

import type {
  LinkPreviewAudience,
  LinkPreviewAudiences,
  LinkPreviewRateLimits,
  LinkPreviewResolver,
} from '../ports/link-previews.ts'
import type { LinkPreviewRow, UnitOfWork } from '../ports/persistence.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import { EVENT_PAYLOAD_VERSION, LINK_PREVIEW_REQUESTED } from './events.ts'
import { createVersionedReader } from './versioned-reader.ts'

/**
 * Link previews as the rest of the product sees them (ADR-042): read the
 * snapshots for a set of links, ask for the ones that are missing, and, in a
 * background job, fetch them.
 *
 * Reading never fetches. A link with no usable snapshot is shown as a plain
 * link, a fetch is queued through the outbox, and the next read finds the
 * result. That keeps a slow or hostile host out of every request, and it is
 * what makes a document render the same for every reader at the same moment.
 */

export interface LinkPreviewDependencies {
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly audiences: LinkPreviewAudiences
  readonly limits: LinkPreviewRateLimits
}

/** The three boundaries a composition root chooses; the rest of the dependencies are shared with everything else. */
export interface LinkPreviewPorts {
  readonly audiences: LinkPreviewAudiences
  readonly resolver: LinkPreviewResolver
  readonly limits: LinkPreviewRateLimits
}

export interface LinkPreviewFetchDependencies extends LinkPreviewDependencies, LinkPreviewPorts {}

// ---------------------------------------------------------------------------
// The stored format (ADR-033: versioned, read by dispatch)
// ---------------------------------------------------------------------------

const STORED_PREVIEW_VERSION = 1

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** `undefined` for a value that is not an image, so `null` can mean "no image". */
function readImage(value: unknown): PreviewImage | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const { hash, width, height, mediaType } = value
  if (
    typeof hash !== 'string' ||
    typeof mediaType !== 'string' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return undefined
  }
  return { hash, width, height, mediaType }
}

/** The optional extensions of a preview (ADR-033: additive). One that is malformed is left out, not fatal. */
function readStatus(value: unknown): LinkPreview['status'] {
  if (!isRecord(value)) return undefined
  const label = text(value['label'])
  const tone = PREVIEW_TONES.find((candidate) => candidate === value['tone'])
  return label === null || tone === undefined ? undefined : { label, tone }
}

function readEmbed(value: unknown): LinkPreview['embed'] {
  if (!isRecord(value)) return undefined
  const provider = text(value['provider'])
  const src = text(value['src'])
  const ratio = value['aspectRatio']
  return provider === null || src === null || typeof ratio !== 'number' || !(ratio > 0)
    ? undefined
    : { provider, src, aspectRatio: ratio }
}

function readFile(value: unknown): LinkPreview['file'] {
  if (!isRecord(value)) return undefined
  const mediaType = text(value['mediaType'])
  const bytes = value['bytes']
  return mediaType === null
    ? undefined
    : { mediaType, bytes: typeof bytes === 'number' ? bytes : null, name: text(value['name']) }
}

function readKind(value: unknown): LinkPreviewKind | null {
  return LINK_PREVIEW_KINDS.find((kind) => kind === value) ?? null
}

function readLayer(value: unknown): LinkPreviewLayer | null {
  return LINK_PREVIEW_LAYERS.find((layer) => layer === value) ?? null
}

function readFailure(value: string | null): LinkPreviewFailure {
  return LINK_PREVIEW_FAILURES.find((failure) => failure === value) ?? 'unreachable'
}

/** Version 1: a `LinkPreview` plus its version. A record that is not one reads as null, and is fetched again. */
function readVersion1(value: unknown): LinkPreview | null {
  // The versioned reader has already established an object; this is for the type.
  /* v8 ignore next */
  if (!isRecord(value)) return null
  const thumbnail = readImage(value['thumbnail'])
  const favicon = readImage(value['favicon'])
  const kind = readKind(value['kind'])
  const layer = readLayer(value['layer'])
  const url = text(value['url'])
  const canonicalUrl = text(value['canonicalUrl'])
  const title = text(value['title'])
  const fetchedAt = text(value['fetchedAt'])
  const status = readStatus(value['status'])
  const embed = readEmbed(value['embed'])
  const file = readFile(value['file'])
  if (
    thumbnail === undefined ||
    favicon === undefined ||
    kind === null ||
    layer === null ||
    url === null ||
    canonicalUrl === null ||
    title === null ||
    fetchedAt === null
  ) {
    return null
  }
  return {
    url,
    canonicalUrl,
    title,
    description: text(value['description']),
    siteName: text(value['siteName']),
    kind,
    thumbnail,
    favicon,
    layer,
    fetchedAt,
    ...(status === undefined ? {} : { status }),
    ...(embed === undefined ? {} : { embed }),
    ...(file === undefined ? {} : { file }),
  }
}

export const storedPreviewReader = createVersionedReader<LinkPreview>({
  [STORED_PREVIEW_VERSION]: readVersion1,
})

function toStoredPreview(preview: LinkPreview): unknown {
  return { version: STORED_PREVIEW_VERSION, ...preview }
}

// ---------------------------------------------------------------------------
// The queue event
// ---------------------------------------------------------------------------

export interface LinkPreviewRequestedPayload {
  readonly version: number
  readonly url: string
  readonly scope: string
  readonly requestedBy: UserId
}

const requestedReader = createVersionedReader<LinkPreviewRequestedPayload>({
  [EVENT_PAYLOAD_VERSION]: (payload) => {
    // The versioned reader has already established an object; this is for the type.
    /* v8 ignore next */
    if (!isRecord(payload)) return null
    const url = text(payload['url'])
    const scope = text(payload['scope'])
    const requestedBy = text(payload['requestedBy'])
    if (url === null || scope === null || requestedBy === null) return null
    return { version: EVENT_PAYLOAD_VERSION, url, scope, requestedBy: toUserId(requestedBy) }
  },
})

/** A `LinkPreviewRequested` payload, or null when this release cannot read it. */
export function parseLinkPreviewRequested(payload: unknown): LinkPreviewRequestedPayload | null {
  return requestedReader.read(payload)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Past this, a page of links is a bug or an attack, and the rest are not looked at. */
export const MAX_LINKS_PER_READ = 50

export interface LinkPreviewReadCommand {
  readonly userId: UserId
  readonly urls: readonly string[]
}

export interface LinkPreviewReading {
  /** What was asked about, as written. */
  readonly url: string
  /** The normalised URL the answer is stored under; null when the URL cannot be previewed at all. */
  readonly key: string | null
  readonly view: LinkPreviewView
}

/**
 * The best row among those found for one key: a stored preview over anything
 * else, then whatever the audience's own scope says (a failure, a pending
 * request).
 *
 * Only the audience's **own scope** is ever read (ADR-042, security review
 * S10). A preview is a snapshot of what one fetch found under one policy, and
 * a restrictive policy must never be shown what a looser one found: the looser
 * fetch may have followed a redirect to a host this audience blocks, or
 * collected a picture its mode forbids. The cost is one fetch per distinct
 * policy rather than one for the instance, which only organisations that
 * restrict links pay.
 */
function choose(rows: readonly LinkPreviewRow[]): LinkPreviewRow | null {
  return (
    rows.find((row) => row.state === 'ready' && storedPreviewReader.read(row.document) !== null) ??
    rows[0] ??
    null
  )
}

/** Hides what the viewing organisation's policy does not allow to be shown. */
function visibleTo(audience: LinkPreviewAudience, preview: LinkPreview): LinkPreview {
  return audience.policy.images ? preview : { ...preview, thumbnail: null, favicon: null }
}

interface Classified {
  readonly view: LinkPreviewView
  readonly wantsFetch: boolean
}

function classify(
  row: LinkPreviewRow | null,
  audience: LinkPreviewAudience,
  now: Date,
): Classified {
  if (row === null) return { view: { state: 'pending' }, wantsFetch: true }

  const preview = row.state === 'ready' ? storedPreviewReader.read(row.document) : null
  if (preview !== null) {
    const stale = isStale(row.fetchedAt, now)
    return {
      view: { state: 'ready', preview: visibleTo(audience, preview), stale },
      wantsFetch: stale,
    }
  }

  const waitUntil = row.state === 'failed' ? (row.retryAfter ?? retryAfter(row.fetchedAt)) : null
  if (waitUntil !== null && now.getTime() < waitUntil.getTime()) {
    return { view: { state: 'unavailable', reason: readFailure(row.failure) }, wantsFetch: false }
  }

  // Asked for and not here yet, a failure whose time is up, or a row this release cannot read.
  return { view: { state: 'pending' }, wantsFetch: true }
}

/**
 * Queues a fetch for each key, in one transaction with the pending marks, and
 * answers which were actually queued. A key another request already queued is
 * left alone, so a page opened by a hundred readers asks for each link once.
 */
async function queueFetches(
  deps: LinkPreviewDependencies,
  input: {
    readonly userId: UserId
    readonly audience: LinkPreviewAudience
    readonly keys: readonly string[]
    readonly force: boolean
  },
): Promise<readonly string[]> {
  if (input.keys.length === 0) return []
  // A person's page of links is free to look up; each new fetch it would cause is rationed. The
  // links left out are not lost: they read as pending, and are queued by a later read once the
  // allowance has refilled.
  const allowed = deps.limits.allowQueued(input.userId, input.keys.length)
  const keys = input.keys.slice(0, allowed)
  if (keys.length === 0) return []
  const now = deps.clock.now()
  return deps.uow.run(async (repos) => {
    const toQueue = await repos.linkPreviews.requestFetch({
      scope: input.audience.scope,
      keys,
      now,
      force: input.force,
    })
    // One statement for the lot: a page of fifty new links is one insert, not fifty.
    await repos.outbox.writeMany(
      toQueue.map((url) => {
        const payload: LinkPreviewRequestedPayload = {
          version: EVENT_PAYLOAD_VERSION,
          url,
          scope: input.audience.scope,
          requestedBy: input.userId,
        }
        return { id: deps.ids.uuid(), type: LINK_PREVIEW_REQUESTED, payload, now }
      }),
    )
    return toQueue
  })
}

/**
 * What to show for each of these links, from what is stored, in one read.
 *
 * Order and length match the request. Anything the viewer's organisation does
 * not allow is `blocked` without being looked up, a missing or stale link
 * queues a fetch and shows what there is, and nothing here waits on the
 * network.
 */
export async function getLinkPreviews(
  deps: LinkPreviewDependencies,
  command: LinkPreviewReadCommand,
): Promise<readonly LinkPreviewReading[]> {
  const audience = await deps.audiences.forPerson(command.userId)
  const { readings, wanted } = await read(deps, audience, command.urls)
  await queueFetches(deps, { userId: command.userId, audience, keys: [...wanted], force: false })
  return readings
}

/**
 * What to show for each of these links, from what is stored, **and nothing
 * else**: it never queues a fetch.
 *
 * For a reader who is not a signed-in member: the public site, an export, a
 * crawler. Their page loads must never be able to cause a request to anyone's
 * server, or a stranger could make Quill fetch any address by asking for a
 * page. They are shown whatever has been stored by someone who could ask, and a
 * link nobody has previewed is a plain link.
 */
export async function peekLinkPreviews(
  deps: Pick<LinkPreviewDependencies, 'uow' | 'clock'>,
  command: { readonly audience: LinkPreviewAudience; readonly urls: readonly string[] },
): Promise<readonly LinkPreviewReading[]> {
  return (await read(deps, command.audience, command.urls)).readings
}

interface Read {
  readonly readings: readonly LinkPreviewReading[]
  /** The addresses that have no usable preview and want a fetch. */
  readonly wanted: ReadonlySet<string>
}

async function read(
  deps: Pick<LinkPreviewDependencies, 'uow' | 'clock'>,
  audience: LinkPreviewAudience,
  urls: readonly string[],
): Promise<Read> {
  const asked = urls.slice(0, MAX_LINKS_PER_READ).map((url) => {
    const key = normaliseUrl(url)
    return { url, key }
  })

  const lookups = asked.flatMap(({ key }) => {
    if (key === null || !audience.policy.permits(new URL(key))) return []
    return [key]
  })
  const unique = [...new Set(lookups)]
  const rows =
    unique.length === 0 ? [] : await deps.uow.repos.linkPreviews.findMany([audience.scope], unique)
  const rowsByKey = Map.groupBy(rows, (row) => row.key)
  const now = deps.clock.now()

  const wanted = new Set<string>()
  const readings = asked.map(({ url, key }): LinkPreviewReading => {
    if (key === null) return { url, key, view: { state: 'unavailable', reason: 'invalid_url' } }
    if (!audience.policy.permits(new URL(key))) return { url, key, view: { state: 'blocked' } }
    const { view, wantsFetch } = classify(choose(rowsByKey.get(key) ?? []), audience, now)
    if (wantsFetch) wanted.add(key)
    return { url, key, view }
  })
  return { readings, wanted }
}

// ---------------------------------------------------------------------------
// Forcing a refresh
// ---------------------------------------------------------------------------

export type RefreshFailure = 'invalid_url' | 'blocked' | 'rate_limited'

/**
 * "Refresh preview" in the editor: asks for a fresh fetch now, even of a link
 * that failed an hour ago. Limited per person, because it is the one way a
 * signed-in person can cause a request to a third-party host on demand.
 */
export async function refreshLinkPreview(
  deps: LinkPreviewFetchDependencies,
  command: { readonly userId: UserId; readonly url: string },
): Promise<Result<LinkPreviewView, RefreshFailure>> {
  const key = normaliseUrl(command.url)
  if (key === null) return err('invalid_url')
  const audience = await deps.audiences.forPerson(command.userId)
  if (!audience.policy.permits(new URL(key))) return err('blocked')
  if (!deps.limits.allowRefresh(command.userId)) return err('rate_limited')

  await queueFetches(deps, { userId: command.userId, audience, keys: [key], force: true })
  const rows = await deps.uow.repos.linkPreviews.findMany([audience.scope], [key])
  // The refresh is queued, so say so, whatever the old row says: pending, or the old preview marked stale.
  const row = choose(rows)
  const preview = row?.state === 'ready' ? storedPreviewReader.read(row.document) : null
  return ok(
    preview === null
      ? { state: 'pending' }
      : { state: 'ready', preview: visibleTo(audience, preview), stale: true },
  )
}

// ---------------------------------------------------------------------------
// Fetching (the outbox consumer's body)
// ---------------------------------------------------------------------------

/**
 * Thrown for an outcome that says nothing about the link (a limit was hit, the
 * fetcher was busy), so the outbox retries it later with backoff and nothing
 * is stored about the link.
 */
export class LinkPreviewRetryLater extends Error {
  /** How long to wait before the next try. */
  readonly retryAfterMs: number

  constructor(reason: string, retryAfterMs: number) {
    super(`Link preview fetch deferred: ${reason}`)
    this.name = 'LinkPreviewRetryLater'
    this.retryAfterMs = retryAfterMs
  }
}

/** How long to leave a fetch when the fetcher itself was too busy to take it. */
const BUSY_RETRY_MS = 5_000

/**
 * Fetches one link under the rules of whoever asked, and stores what came back.
 *
 * - A success replaces the snapshot.
 * - A failure is remembered for an hour (`retryAfter`) and, if a good
 *   snapshot exists, leaves it in place.
 * - `busy` and a rate limit are neither: the event is retried.
 * - A payload this release cannot read is left alone (ADR-033).
 */
export async function fetchLinkPreview(
  deps: LinkPreviewFetchDependencies,
  payload: unknown,
): Promise<void> {
  const event = parseLinkPreviewRequested(payload)
  if (event === null) return
  const key = normaliseUrl(event.url)
  if (key === null) return

  // The scope is the asker's *current* one, not the one written on the event: if the
  // organisation's policy changed while this waited, what comes back was fetched under
  // the new rules and must be stored, and shown, only where those rules apply.
  const audience = await deps.audiences.forPerson(event.requestedBy)
  const scope = audience.scope
  const decision = deps.limits.allowFetch({ host: new URL(key).host, scope })
  if (!decision.allowed) throw new LinkPreviewRetryLater('rate limit', decision.retryAfterMs)

  const result = await deps.resolver.resolve(key, { policy: audience.policy })
  if (!result.ok && result.error === 'busy') {
    throw new LinkPreviewRetryLater('fetcher busy', BUSY_RETRY_MS)
  }

  const now = deps.clock.now()
  await deps.uow.run(async (repos) => {
    if (result.ok) {
      await repos.linkPreviews.putReady({
        scope,
        key,
        document: toStoredPreview(result.value),
        now,
      })
    } else {
      await repos.linkPreviews.putFailure({ scope, key, failure: result.error, now })
    }
  })
}
