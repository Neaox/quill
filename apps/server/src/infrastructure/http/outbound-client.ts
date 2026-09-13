import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'
import type { LookupFunction } from 'node:net'
import { lookup } from 'node:dns/promises'
import { Readable } from 'node:stream'

/**
 * The one client every server-side fetch goes through (ADR-011).
 *
 * A URL the platform did not write — an embed, a source reference, a live
 * block, the breached-password corpus — is an SSRF vector: the server sits
 * inside a network the caller does not, so "fetch this for me" reaches the
 * metadata service, the database, and the admin port unless something stops
 * it. This is that something: a host allowlist, DNS resolution checked
 * against every address family that means "inside", a connection pinned to
 * the address that was checked, a redirect cap with the same checks re-run on
 * each hop, a timeout, and a response size cap enforced as the body arrives.
 *
 * Three of those were added after the M2 review found the first version
 * checking the right things and then not acting on them:
 *
 * - **Resolve, check, then connect to what was checked** (finding M4). The
 *   old code resolved the hostname, approved the addresses, and handed the
 *   URL to `fetch`, which resolved it again. A DNS server that answers
 *   `93.184.216.34` to the first query and `169.254.169.254` to the second
 *   walks straight through — classic DNS rebinding. The connection now uses
 *   a `lookup` that returns only the address already approved, with
 *   `servername` kept so TLS still validates against the hostname.
 * - **IPv6 is parsed, not pattern-matched** (finding M5). `::ffff:7f00:1` is
 *   loopback written in hex; NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`)
 *   carry an IPv4 address inside them. A check on string prefixes missed all
 *   three, so the address is parsed to sixteen bytes and any embedded IPv4
 *   gets the IPv4 verdict.
 * - **The cap is applied while reading** (finding M6). Buffering the whole
 *   body and then measuring it means a host that ignores the cap has already
 *   spent the memory; the stream is read in chunks and aborted the moment it
 *   goes over.
 *
 * `fetch` and the resolver are parameters so the unit tests drive the whole
 * decision table without a network.
 */

export interface OutboundClientOptions {
  /** Exact hostnames this client may reach. Nothing else resolves, let alone connects. */
  readonly allowedHosts: readonly string[]
  readonly timeoutMs?: number
  readonly maxRedirects?: number
  readonly maxResponseBytes?: number
  readonly fetch?: FetchLike
  readonly resolve?: ResolveHost
}

export interface FetchLike {
  (url: string, init: OutboundFetchInit): Promise<OutboundFetchResponse>
}

/**
 * As much of a `Response` as this client reads.
 *
 * A global `Response` satisfies it, so a test can go on answering with one;
 * stating the shape rather than naming the class is what lets the real
 * implementation below be a `node:https` request, which is the only way to
 * choose the address a connection goes to.
 */
export interface OutboundFetchResponse {
  readonly status: number
  readonly headers: { get(name: string): string | null }
  readonly body: ReadableStream<Uint8Array> | null
}

export interface OutboundFetchInit {
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly redirect: 'manual'
  readonly signal: AbortSignal
  /** Present only on a `post`; the transport writes it before ending the request. */
  readonly body?: string
  /**
   * The addresses this connection may use: the ones `check` just approved.
   * The real transport pins its socket to them; a test's fake ignores them.
   */
  readonly addresses: readonly string[]
}

/** Every address a hostname resolves to. All of them must be public. */
export interface ResolveHost {
  (hostname: string): Promise<readonly string[]>
}

export interface OutboundRequest {
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

/**
 * A `post` carries a body and, unlike a `get`, is never redirected.
 *
 * Following a redirect on a request that carries credentials — which is what
 * an OIDC token exchange is — would replay the client secret and the
 * authorisation code at whatever host the first one named. The allowlist
 * would still hold, but the secret would have been sent somewhere its owner
 * did not choose, so a 3xx here is a failure rather than a hop.
 */
export interface OutboundPostRequest extends OutboundRequest {
  readonly body: string
  readonly contentType: string
}

export interface OutboundResponse {
  readonly status: number
  readonly body: string
}

export type OutboundFailure =
  | 'host_not_allowed'
  | 'scheme_not_allowed'
  | 'private_address'
  | 'dns_failure'
  | 'too_many_redirects'
  | 'redirect_without_location'
  | 'redirect_not_followed'
  | 'response_too_large'
  | 'timeout'
  | 'network_error'

export class OutboundRequestError extends Error {
  readonly reason: OutboundFailure

  constructor(reason: OutboundFailure, message: string) {
    super(message)
    this.name = 'OutboundRequestError'
    this.reason = reason
  }
}

/**
 * The read half. Stated separately because most callers only ever fetch, and
 * a caller that cannot post is a caller that cannot be talked into replaying
 * a credential somewhere.
 */
export interface OutboundReader {
  get(request: OutboundRequest): Promise<OutboundResponse>
}

export interface OutboundClient extends OutboundReader {
  /**
   * One hop, with a body, to an allow-listed host. Used by the OIDC token
   * exchange (ADR-011), which is the first outbound call the platform makes
   * that is not a read.
   */
  post(request: OutboundPostRequest): Promise<OutboundResponse>
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024

async function resolveWithDns(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

/** Loopback, private, link-local, carrier-grade NAT, multicast, and the cloud metadata addresses. */
function ipv4BytesBlocked(bytes: readonly number[]): boolean {
  const [a = 0, b = 0] = bytes
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, and the 169.254.169.254 metadata service
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // IETF protocol assignments, incl. 192.0.0.192
    (a === 198 && b >= 18 && b <= 19) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  )
}

function ipv4Blocked(address: string): boolean {
  return ipv4BytesBlocked(address.split('.').map(Number))
}

/**
 * An IPv6 address as its sixteen bytes, or null when it is not one.
 *
 * `node:net` will tell us a string *is* an IPv6 address but not what it
 * means, and the meaning is the whole point here: `::ffff:7f00:1`,
 * `::ffff:127.0.0.1` and `127.0.0.1` are the same machine written three ways.
 */
export function ipv6Bytes(address: string): Uint8Array | null {
  if (isIP(address) !== 6) return null
  const bytes = new Uint8Array(16)
  const [head = '', tail] = address.split('::')
  const leading = expand(head)
  const trailing = tail === undefined ? [] : expand(tail)
  // `isIP` has already accepted the address, so it has at most one `::`,
  // every group parses, and the two halves cannot overflow sixteen bytes
  // between them. These are the belt to that braces.
  /* v8 ignore next */
  if (leading === null || trailing === null) return null
  /* v8 ignore next */
  if (leading.length + trailing.length > 16) return null

  bytes.set(leading, 0)
  bytes.set(trailing, 16 - trailing.length)
  return bytes
}

/** One side of a `::`, as bytes. A trailing dotted-quad contributes four. */
function expand(side: string): number[] | null {
  if (side.length === 0) return []
  const bytes: number[] = []
  for (const group of side.split(':')) {
    if (group.includes('.')) {
      const quad = group.split('.').map(Number)
      /* v8 ignore next -- `isIP` has already accepted the address, so an
         embedded dotted-quad always has four octets in range. */
      if (quad.length !== 4 || quad.some((octet) => !Number.isInteger(octet))) return null
      bytes.push(...quad)
      continue
    }
    const value = Number.parseInt(group, 16)
    /* v8 ignore next -- likewise: every remaining group is valid hex. */
    if (!Number.isInteger(value)) return null
    bytes.push(value >> 8, value & 0xff)
  }
  return bytes
}

function isRedirect(status: number): boolean {
  return status >= 300 && status <= 399
}

function allZero(bytes: Uint8Array, from: number, to: number): boolean {
  return bytes.slice(from, to).every((byte) => byte === 0)
}

/**
 * The IPv4 address this IPv6 address carries, if any.
 *
 * Three encodings put an IPv4 address inside an IPv6 one, and a server that
 * treats them as "some IPv6 address" can be pointed at the loopback or the
 * metadata service through every one of them.
 */
function embeddedIpv4(bytes: Uint8Array): number[] | null {
  // ::ffff:0:0/96 — IPv4-mapped, and ::/96 — IPv4-compatible (deprecated).
  if (
    allZero(bytes, 0, 10) &&
    ((bytes[10] === 0xff && bytes[11] === 0xff) || allZero(bytes, 10, 12))
  ) {
    return Array.from(bytes.slice(12, 16))
  }
  // 64:ff9b::/96 and 64:ff9b:1::/48 — NAT64.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return Array.from(bytes.slice(12, 16))
  }
  // 2002::/16 — 6to4 carries the IPv4 address in the next four bytes.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return Array.from(bytes.slice(2, 6))
  }
  return null
}

function ipv6Blocked(address: string): boolean {
  const bytes = ipv6Bytes(address)
  /* v8 ignore next -- `isBlockedAddress` only calls this for an address
     `isIP` has already classified as IPv6. */
  if (bytes === null) return true

  const embedded = embeddedIpv4(bytes)
  if (embedded !== null) return ipv4BytesBlocked(embedded)

  const [first = 0, second = 0] = bytes
  return (
    allZero(bytes, 0, 15) || // :: and ::1
    (first & 0xfe) === 0xfc || // fc00::/7, unique local
    (first === 0xfe && (second & 0xc0) === 0x80) || // fe80::/10, link-local
    first === 0xff || // ff00::/8, multicast
    // 2001:0000::/32 — Teredo, an IPv4 tunnel whose embedded address is
    // obfuscated. Nothing legitimate here needs it, so it is simply refused.
    (first === 0x20 && second === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00)
  )
}

/** Loopback, private, link-local, carrier-grade NAT, multicast, and the cloud metadata addresses. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return ipv4Blocked(address)
  if (family === 6) return ipv6Blocked(address)
  // Not an address at all: nothing here can vouch for it.
  return true
}

/**
 * A `lookup` that answers only with the addresses already approved.
 *
 * This is the whole of the rebinding fix: the socket is opened to an address
 * this process resolved and checked, not to whatever the resolver says a
 * second time. `servername` (set by the caller) keeps TLS validating against
 * the hostname, so pinning the address costs nothing in certificate checking.
 */
export function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const resolved = addresses.map((address) => ({ address, family: isIP(address) }))
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, resolved)
      return
    }
    // `check` refuses an empty answer, so there is always a first address.
    const [first] = resolved
    /* v8 ignore next */
    if (first === undefined) return
    callback(null, first.address, first.family)
  }
}

/**
 * The real transport: one request, to an address this process chose.
 *
 * `fetch` cannot express "connect to this address but speak TLS for that
 * name", which is what a rebinding-proof client needs, so the default
 * implementation is `node:https`. Redirects are never followed here — the
 * caller follows them by hand so every hop is re-checked — and the body is
 * handed back as a stream so the size cap can be applied while it arrives.
 */
export async function nodeFetch(
  url: string,
  init: OutboundFetchInit,
): Promise<OutboundFetchResponse> {
  const target = new URL(url)
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = send(
      target,
      {
        method: init.method,
        headers: init.headers,
        lookup: pinnedLookup(init.addresses),
        servername: target.hostname,
        signal: init.signal,
      },
      resolve,
    )
    outgoing.on('error', reject)
    // `end(undefined)` on a GET is exactly `end()`; a `post` writes its body here.
    outgoing.end(init.body)
  })

  return {
    /* v8 ignore next 2 -- `statusCode` is set on every response Node hands to
       this callback; the fallback exists only to satisfy the type. */
    status: response.statusCode ?? 0,
    headers: {
      get(name: string): string | null {
        const value = response.headers[name.toLowerCase()]
        if (value === undefined) return null
        /* v8 ignore next -- Node never hands back an empty header array. */
        return Array.isArray(value) ? (value[0] ?? null) : value
      },
    },
    body: Readable.toWeb(response),
  }
}

export function createOutboundClient(options: OutboundClientOptions): OutboundClient {
  const allowed = new Set(options.allowedHosts.map((host) => host.toLowerCase()))
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const doFetch: FetchLike = options.fetch ?? nodeFetch
  const resolve = options.resolve ?? resolveWithDns

  /** The addresses this hop may connect to, or a refusal. */
  async function check(target: URL): Promise<readonly string[]> {
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new OutboundRequestError(
        'scheme_not_allowed',
        `Outbound requests may not use ${target.protocol}`,
      )
    }
    if (!allowed.has(target.hostname.toLowerCase())) {
      throw new OutboundRequestError(
        'host_not_allowed',
        `${target.hostname} is not an allowed outbound host`,
      )
    }
    let addresses: readonly string[]
    try {
      addresses = await resolve(target.hostname)
    } catch {
      throw new OutboundRequestError('dns_failure', `${target.hostname} did not resolve`)
    }
    if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
      throw new OutboundRequestError(
        'private_address',
        `${target.hostname} resolves to an address the platform may not reach`,
      )
    }
    return addresses
  }

  /**
   * Reads at most `maxResponseBytes`, and stops the transfer rather than
   * finishing it and complaining afterwards.
   */
  async function readBody(
    response: OutboundFetchResponse,
    controller: AbortController,
  ): Promise<string> {
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (declared > maxResponseBytes) {
      controller.abort()
      throw new OutboundRequestError('response_too_large', 'Response exceeds the size cap')
    }
    if (response.body === null) return ''

    const decoder = new TextDecoder()
    let read = 0
    let text = ''
    const reader = response.body.getReader()
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        read += chunk.value.byteLength
        if (read > maxResponseBytes) {
          controller.abort()
          throw new OutboundRequestError('response_too_large', 'Response exceeds the size cap')
        }
        text += decoder.decode(chunk.value, { stream: true })
      }
    } finally {
      reader.releaseLock()
    }
    return text + decoder.decode()
  }

  /**
   * One hop: check the target, connect only to what was checked, and hand
   * back the response together with the controller the size cap aborts with.
   */
  async function sendOnce(
    target: URL,
    method: string,
    headers: Readonly<Record<string, string>>,
    body: string | undefined,
  ): Promise<{ response: OutboundFetchResponse; controller: AbortController }> {
    const addresses = await check(target)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await doFetch(target.href, {
        method,
        headers,
        // Never followed by the transport: `get` follows redirects by hand so
        // every hop is checked again, and `post` refuses them outright.
        redirect: 'manual',
        signal: controller.signal,
        // Only the addresses this hop's checks approved.
        addresses,
        ...(body === undefined ? {} : { body }),
      })
      return { response, controller }
    } catch (error) {
      throw new OutboundRequestError(
        controller.signal.aborted ? 'timeout' : 'network_error',
        `Request to ${target.hostname} failed: ${String(error)}`,
      )
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async get({ url, headers = {} }): Promise<OutboundResponse> {
      let target = new URL(url)
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        const { response, controller } = await sendOnce(target, 'GET', headers, undefined)

        if (!isRedirect(response.status)) {
          return { status: response.status, body: await readBody(response, controller) }
        }
        const location = response.headers.get('location')
        if (location === null) {
          throw new OutboundRequestError(
            'redirect_without_location',
            `${target.hostname} answered ${response.status} with no Location`,
          )
        }
        target = new URL(location, target)
      }
      throw new OutboundRequestError('too_many_redirects', `More than ${maxRedirects} redirects`)
    },

    async post({ url, headers = {}, body, contentType }): Promise<OutboundResponse> {
      const target = new URL(url)
      const { response, controller } = await sendOnce(
        target,
        'POST',
        {
          ...headers,
          'content-type': contentType,
          'content-length': String(Buffer.byteLength(body)),
        },
        body,
      )
      // A 3xx here would mean replaying the credentials this body carries at
      // a host the caller never named.
      if (isRedirect(response.status)) {
        controller.abort()
        throw new OutboundRequestError(
          'redirect_not_followed',
          `${target.hostname} answered ${response.status} to a POST; redirects are not followed`,
        )
      }
      return { status: response.status, body: await readBody(response, controller) }
    },
  }
}
