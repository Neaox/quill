import { startBudget } from './budget.ts'
import type { Budget } from './budget.ts'
import { createLimiter } from './limiter.ts'
import { createOpenWebResolver } from './open-web-resolver.ts'
import { OutboundRequestError, nodeFetch, resolvePublicAddresses } from './outbound-client.ts'
import type { FetchLike, OutboundFetchResponse, ResolveHost } from './outbound-client.ts'

/**
 * The outbound client for the open web (ADR-042, amending ADR-011).
 *
 * A link preview has to reach whatever host a person pasted, so there is no
 * allowlist here. That makes everything else the only defence, and it is the
 * same defence as the allowlisted client, run on every hop: the hostname is
 * resolved, every answer must be public (`resolvePublicAddresses`), and the
 * socket is pinned to the addresses that were checked (`nodeFetch`). On top of
 * that, because the caller does not choose the host:
 *
 * - only ports 80 and 443, and no credentials in the URL;
 * - one **total** budget for the whole call, redirects and body included. The
 *   allowlisted client stops its timer once headers arrive, which would let a
 *   host drip a body forever; here the clock keeps running while we read;
 * - the media type is decided from the headers **before** the body is read, so
 *   a PDF or a video is never downloaded to be thrown away. A caller that wants
 *   to know that a link is a file (`headersOnly`) is answered from the headers
 *   alone and the body is cancelled unread;
 * - bodies are never compressed (`accept-encoding: identity`, and any other
 *   `content-encoding` is refused), so the byte cap is a cap on real bytes and
 *   a compression bomb has nothing to expand;
 * - the body is read as a stream and reading stops at the caller's marker
 *   (`</head>` for a page) or at the byte cap, whichever comes first.
 *
 * The caller states what it will accept and how much (`pageRequest`,
 * `jsonRequest`, `imageRequest`), so the limits sit beside the ADR that sets
 * them rather than being rediscovered by each layer.
 *
 * Pattern: a strategy-free sibling of `createOutboundClient`, sharing its
 * primitives rather than extending it, so loosening one cannot loosen the other.
 */

const DEFAULT_TIMEOUT_MS = 6_000
const DEFAULT_MAX_REDIRECTS = 5
/** Sockets, buffers and DNS queries in flight at once, across every organisation. */
const DEFAULT_MAX_CONCURRENT = 8
const DEFAULT_MAX_QUEUED = 64
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
])
const ALLOWED_PORTS: ReadonlySet<string> = new Set(['', '80', '443'])

const PAGE_BYTES = 512 * 1024
const JSON_BYTES = 256 * 1024
const IMAGE_BYTES = 5 * 1024 * 1024

/**
 * What the open-web client will do, in one place: the client enforces it, and
 * the page at `/bot` tells site owners about it, so the two cannot disagree.
 */
export const OPEN_WEB_LIMITS = {
  timeoutSeconds: DEFAULT_TIMEOUT_MS / 1000,
  maxRedirects: DEFAULT_MAX_REDIRECTS,
  pageKiB: PAGE_BYTES / 1024,
  imageMiB: IMAGE_BYTES / (1024 * 1024),
} as const

export interface OpenWebRequest {
  readonly url: string
  /** Media types this call accepts. `image/*` matches any image subtype. */
  readonly accept: readonly string[]
  readonly maxBytes: number
  /**
   * What to do when the body is longer than `maxBytes`. A page is still useful
   * cut short, since its metadata is at the top; an image or a JSON document
   * cut short is garbage, so those are refused.
   */
  readonly overflow: 'truncate' | 'reject'
  /**
   * Media types answered from the headers alone, without reading a byte of the body (a PDF, a
   * video, a document): the response carries the type, the declared size and the suggested file
   * name, and the transfer is cancelled. Checked only for a type `accept` does not take.
   */
  readonly headersOnly?: readonly string[]
  /** An ASCII marker (case-insensitive) after which reading stops. */
  readonly stopAfter?: string
  readonly headers?: Readonly<Record<string, string>>
  /**
   * Whether this URL may be contacted at all (an organisation's policy). It is
   * asked on **every** hop, not just for the first URL: a redirect, or a link
   * the page itself names, is a different host the policy has not seen.
   */
  readonly permit?: UrlPermit | undefined
  /** What the request is for, so a log can say whether it was a page, an oEmbed answer or a picture. */
  readonly purpose?: FetchPurpose | undefined
}

export type FetchPurpose = 'page' | 'oembed' | 'image'

/**
 * What is recorded about a fetch (ADR-042: "every fetch is logged with its host
 * and outcome, never the response").
 *
 * The **host**, never the path or query: a link can carry a token, and a log
 * is read by more people and kept longer than the thing it describes. Nothing
 * of the response is here, only how it went. This is what lets an operator see
 * which sites Quill talks to, how often, and how it goes, and lets a site owner
 * who complains be answered.
 */
export interface FetchEvent {
  /** The host asked for. */
  readonly host: string
  readonly purpose: FetchPurpose | undefined
  /** `ok`, or the reason it failed (`OutboundFailure`). */
  readonly outcome: string
  /** The status of the last response, or null if there was none. */
  readonly status: number | null
  readonly redirects: number
  readonly bytes: number
  readonly durationMs: number
}

export interface FetchObserver {
  (event: FetchEvent): void
}

export interface UrlPermit {
  (url: URL): boolean
}

export interface OpenWebResponse {
  readonly status: number
  /** Where the request ended up, after redirects. */
  readonly url: string
  /** The media type without parameters, lower-case; empty for a non-success status. */
  readonly mediaType: string
  /** The `charset` parameter of `content-type`, lower-case, if it had one. */
  readonly charset: string | null
  readonly body: Uint8Array
  /** True when reading stopped before the body ended (the marker or the cap). */
  readonly truncated: boolean
  /** For a `headersOnly` answer: the length the host declared, or null if it did not say. */
  readonly declaredBytes?: number | null
  /** For a `headersOnly` answer: the raw `content-disposition`, for the caller to read a file name from. */
  readonly disposition?: string | null
}

export interface OpenWebReader {
  get(request: OpenWebRequest): Promise<OpenWebResponse>
}

export interface OpenWebClientOptions {
  /** `<Brand>Bot/<version> (+<instance URL>/bot)`; honest by design (ADR-042). */
  readonly userAgent: string
  readonly timeoutMs?: number
  readonly maxRedirects?: number
  /** At most this many requests run at once; the rest queue. */
  readonly maxConcurrent?: number
  /** At most this many wait; any more are refused with `too_busy`. */
  readonly maxQueued?: number
  /** Told how every fetch went. An observer that throws is ignored: logging must not break a fetch. */
  readonly observe?: FetchObserver
  readonly fetch?: FetchLike
  readonly resolve?: ResolveHost
}

/** An HTML page, read up to the end of `<head>`, where its metadata lives. */
export function pageRequest(url: string): OpenWebRequest {
  return {
    url,
    purpose: 'page',
    accept: ['text/html', 'application/xhtml+xml', 'application/json'],
    maxBytes: PAGE_BYTES,
    overflow: 'truncate',
    stopAfter: '</head>',
  }
}

/**
 * A page, or else a file: an HTML page is read up to the end of `<head>` as ever, and a link
 * to a file of one of `fileTypes` is answered from its headers with no body read at all.
 */
export function pageOrFileRequest(url: string, fileTypes: readonly string[]): OpenWebRequest {
  return { ...pageRequest(url), headersOnly: fileTypes }
}

/** An oEmbed JSON document. XML oEmbed is refused by the media type. */
export function jsonRequest(url: string): OpenWebRequest {
  return {
    url,
    purpose: 'oembed',
    accept: ['application/json'],
    maxBytes: JSON_BYTES,
    overflow: 'reject',
  }
}

/** An image of any type; the caller sniffs the bytes and re-encodes (ADR-042). */
export function imageRequest(url: string): OpenWebRequest {
  return {
    url,
    purpose: 'image',
    accept: ['image/*'],
    maxBytes: IMAGE_BYTES,
    overflow: 'reject',
  }
}

function refuse(
  reason: ConstructorParameters<typeof OutboundRequestError>[0],
  message: string,
): never {
  throw new OutboundRequestError(reason, message)
}

/** The host of a URL, or a marker when it is not one: never the URL, which may carry a token. */
function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname
  } catch {
    return '[invalid url]'
  }
}

function parseUrl(raw: string | URL, base?: URL): URL {
  try {
    return new URL(raw, base)
  } catch {
    return refuse('invalid_url', 'The URL could not be parsed')
  }
}

/** The scheme, credential and port rules, before any network work. */
function assertReachable(target: URL): void {
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    refuse('scheme_not_allowed', `Outbound requests may not use ${target.protocol}`)
  }
  if (target.username !== '' || target.password !== '') {
    refuse('credentials_in_url', 'A URL carrying credentials is never fetched')
  }
  if (!ALLOWED_PORTS.has(target.port)) {
    refuse('port_not_allowed', `Port ${target.port} is not reachable; only 80 and 443 are`)
  }
}

interface ContentType {
  readonly mediaType: string
  readonly charset: string | null
}

function parseContentType(header: string | null): ContentType {
  const [essence = '', ...parameters] = (header ?? '').split(';')
  const charset = parameters
    .map((parameter) => /^\s*charset\s*=\s*"?([^";\s]+)"?\s*$/i.exec(parameter)?.[1])
    .find((value) => value !== undefined)
  return { mediaType: essence.trim().toLowerCase(), charset: charset?.toLowerCase() ?? null }
}

function accepts(accept: readonly string[], mediaType: string): boolean {
  return accept.some((allowed) =>
    allowed.endsWith('/*') ? mediaType.startsWith(allowed.slice(0, -1)) : mediaType === allowed,
  )
}

/** A length the host declared, if it is a whole number of bytes. */
function declaredLength(header: string | null): number | null {
  if (header === null || !/^\d{1,15}$/u.test(header.trim())) return null
  return Number(header.trim())
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  if (first.length === 0) return second
  const joined = new Uint8Array(first.length + second.length)
  joined.set(first, 0)
  joined.set(second, first.length)
  return joined
}

/**
 * Where a lower-case ASCII `marker` first appears in `bytes`, ignoring case; -1 if it does not.
 *
 * Read as Latin-1, which maps each byte to one character, so an index into the
 * string is an index into the bytes. Lower-casing Latin-1 text cannot create an
 * ASCII match that was not there, so a marker like `</head>` is found whatever
 * the page's own encoding is.
 */
function indexOfMarker(bytes: Uint8Array, marker: string): number {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString('latin1')
    .toLowerCase()
    .indexOf(marker)
}

interface ReadLimits {
  readonly maxBytes: number
  readonly overflow: 'truncate' | 'reject'
  readonly marker: string | null
}

/**
 * Reads the body chunk by chunk and stops the transfer — cancelling the
 * stream closes the socket — the moment it has what was asked for.
 */
async function readBounded(
  response: OutboundFetchResponse,
  limits: ReadLimits,
  budget: Budget,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (response.body === null) return { bytes: new Uint8Array(0), truncated: false }

  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  // The last `marker.length - 1` bytes seen: a marker split across two chunks
  // is still found, and nothing longer needs keeping.
  let carry: Uint8Array = new Uint8Array(0)
  const reader = response.body.getReader()

  try {
    for (;;) {
      const next = await budget.guard(reader.read())
      if (next.done) break
      let chunk = next.value

      if (limits.marker !== null) {
        const window = concat(carry, chunk)
        const hit = indexOfMarker(window, limits.marker)
        if (hit === -1) {
          carry = window.subarray(Math.max(0, window.length - (limits.marker.length - 1)))
        } else {
          // The marker ends inside this chunk: keep up to and including it.
          chunk = chunk.subarray(0, hit + limits.marker.length - carry.length)
          truncated = true
        }
      }

      const room = limits.maxBytes - total
      if (chunk.length > room) {
        if (limits.overflow === 'reject') {
          refuse('response_too_large', 'Response exceeds the size cap')
        }
        chunk = chunk.subarray(0, room)
        truncated = true
      }
      chunks.push(chunk)
      total += chunk.length
      if (truncated) break
    }
  } finally {
    // A stream that ended on its own has nothing left to cancel; one we left
    // early still holds a socket, which this releases. Neither may throw.
    await reader.cancel().catch(() => undefined)
  }

  return { bytes: chunks.reduce(concat, new Uint8Array(0)), truncated }
}

/** Releases the socket of a response whose body will not be read. */
async function discard(response: OutboundFetchResponse): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

export function createOpenWebClient(options: OpenWebClientOptions): OpenWebReader {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  // The real transport is exercised against a socket in `outbound-transport.test.ts`.
  /* v8 ignore next */
  const doFetch: FetchLike = options.fetch ?? nodeFetch
  const resolve = options.resolve ?? createOpenWebResolver()
  const limiter = createLimiter({
    maxConcurrent: options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    maxQueued: options.maxQueued ?? DEFAULT_MAX_QUEUED,
  })

  function headersFor(request: OpenWebRequest): Record<string, string> {
    // This client talks to hosts no one vetted, and follows redirects to others.
    // A credential handed to it would be sent to whoever the page or a redirect
    // names, so it refuses to carry one at all; a call that needs to
    // authenticate belongs on the allowlisted client or a connector.
    const credential = Object.keys(request.headers ?? {}).find((name) =>
      CREDENTIAL_HEADERS.has(name.toLowerCase()),
    )
    if (credential !== undefined) {
      refuse('credentials_in_request', `The open-web client never sends a ${credential} header`)
    }
    return {
      'user-agent': options.userAgent,
      accept: request.accept.join(', '),
      'accept-encoding': 'identity',
      ...request.headers,
    }
  }

  async function hop(
    target: URL,
    request: OpenWebRequest,
    headers: Readonly<Record<string, string>>,
    budget: Budget,
  ): Promise<OutboundFetchResponse> {
    assertReachable(target)
    if (request.permit !== undefined && !request.permit(target)) {
      refuse('blocked_by_policy', `${target.hostname} is not permitted by policy`)
    }
    const addresses = await budget.guard(resolvePublicAddresses(target.hostname, resolve))
    return budget.guard(
      doFetch(target.href, {
        method: 'GET',
        headers,
        // Followed by hand below, so every hop is checked again.
        redirect: 'manual',
        signal: budget.signal,
        addresses,
      }),
    )
  }

  async function run(
    request: OpenWebRequest,
    budget: Budget,
    stats: { redirects: number },
  ): Promise<OpenWebResponse> {
    const headers = headersFor(request)
    const limits: ReadLimits = {
      maxBytes: request.maxBytes,
      overflow: request.overflow,
      marker: request.stopAfter?.toLowerCase() ?? null,
    }
    let target = parseUrl(request.url)

    for (let hops = 0; hops <= maxRedirects; hops += 1) {
      stats.redirects = hops
      const response = await hop(target, request, headers, budget)

      if (response.status >= 300 && response.status <= 399) {
        const location = response.headers.get('location')
        await discard(response)
        if (location === null) {
          refuse(
            'redirect_without_location',
            `${target.hostname} answered ${response.status} with no Location`,
          )
        }
        target = parseUrl(location, target)
        continue
      }

      if (response.status < 200 || response.status > 299) {
        await discard(response)
        return {
          status: response.status,
          url: target.href,
          mediaType: '',
          charset: null,
          body: new Uint8Array(0),
          truncated: false,
        }
      }

      const { mediaType, charset } = parseContentType(response.headers.get('content-type'))
      if (
        !accepts(request.accept, mediaType) &&
        request.headersOnly !== undefined &&
        accepts(request.headersOnly, mediaType)
      ) {
        // A file: its headers say what it is and how big, and that is all this asks of it.
        await discard(response)
        return {
          status: response.status,
          url: target.href,
          mediaType,
          charset: null,
          body: new Uint8Array(0),
          truncated: false,
          declaredBytes: declaredLength(response.headers.get('content-length')),
          disposition: response.headers.get('content-disposition'),
        }
      }
      if (!accepts(request.accept, mediaType)) {
        await discard(response)
        refuse(
          'content_type_not_allowed',
          `${target.hostname} answered with ${mediaType || 'no media type'}`,
        )
      }
      const encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
      if (encoding !== undefined && encoding !== '' && encoding !== 'identity') {
        await discard(response)
        refuse(
          'content_encoding_not_allowed',
          `${target.hostname} answered with content-encoding ${encoding}`,
        )
      }
      const declared = Number(response.headers.get('content-length') ?? '0')
      if (declared > request.maxBytes && request.overflow === 'reject') {
        await discard(response)
        refuse('response_too_large', 'Response exceeds the size cap')
      }

      const { bytes, truncated } = await readBounded(response, limits, budget)
      return {
        status: response.status,
        url: target.href,
        mediaType,
        charset,
        body: bytes,
        truncated,
      }
    }
    return refuse('too_many_redirects', `More than ${maxRedirects} redirects`)
  }

  function report(request: OpenWebRequest, result: Omit<FetchEvent, 'host' | 'purpose'>): void {
    if (options.observe === undefined) return
    try {
      // The host only: see `FetchEvent`. The URL was valid, or the fetch would not have begun.
      options.observe({ host: hostOf(request.url), purpose: request.purpose, ...result })
    } catch {
      // Logging is not allowed to break the thing it describes.
    }
  }

  return {
    get(request) {
      // The clock starts when the request does, not while it waits for a slot.
      return limiter.run(async () => {
        const budget = startBudget(timeoutMs)
        const stats = { redirects: 0 }
        const started = performance.now()
        let outcome = 'ok'
        let response: OpenWebResponse | undefined
        try {
          response = await run(request, budget, stats)
          return response
        } catch (error) {
          const failure =
            error instanceof OutboundRequestError
              ? error
              : new OutboundRequestError('network_error', `Request failed: ${String(error)}`)
          outcome = failure.reason
          throw failure
        } finally {
          budget.dispose()
          report(request, {
            outcome,
            status: response?.status ?? null,
            redirects: stats.redirects,
            bytes: response?.body.byteLength ?? 0,
            durationMs: Math.round(performance.now() - started),
          })
        }
      })
    },
  }
}
