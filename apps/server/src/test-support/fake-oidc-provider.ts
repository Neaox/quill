import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createHash, createSign, generateKeyPairSync } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import { nodeFetch, createOutboundClient } from '../infrastructure/http/outbound-client.ts'
import type { OutboundClientFactory } from '../auth/oidc/discovery.ts'

/**
 * A real OpenID Connect provider, in this process, over a real socket.
 *
 * It serves the three documents the flow reads — discovery, the key set, and
 * the token endpoint — signs real RS256 tokens with a real key pair, and
 * enforces the parts of the protocol a test needs to see enforced: the PKCE
 * verifier must hash to the challenge the authorisation request carried, the
 * redirect URI must match, the code is single use, and the client must
 * authenticate. So an integration test drives the actual HTTP path rather
 * than a stub of it.
 *
 * **One thing is substituted, and only one.** The SSRF-safe client refuses
 * every loopback address by design (`infrastructure/http/outbound-client.ts`),
 * which is exactly what any in-process server must listen on. So the client a
 * test hands the server resolves the fake issuer's hostname to a documentation
 * address and then dials the loopback port, leaving the allowlist, the
 * redirect cap, the timeout, the size cap, and the real `node:http` transport
 * in place. The DNS-pinning layer that is bypassed has its own decision-table
 * tests in `outbound-client.test.ts`.
 */

/** RFC 5737 TEST-NET-3: never routed, and public as far as the SSRF checks are concerned. */
const PUBLIC_TEST_ADDRESS = '203.0.113.7'

export interface FakeOidcOptions {
  readonly clientId: string
  readonly clientSecret: string
  /**
   * The clock the tokens are stamped with — the *server's* clock, not the
   * wall clock. The harness runs on a fake clock fixed in the past, and a
   * token stamped `iat` from the real one would be refused as issued in the
   * future, which is exactly the check working.
   */
  readonly now: () => Date
  /** Defaults to the standard set; a test overrides it to exercise `client_secret_post`. */
  readonly tokenEndpointAuthMethods?: readonly string[]
  /**
   * Fixed rather than ephemeral, for `e2e/sso.spec.ts`: a real server process
   * boots with `OIDC_FAKE_ISSUER` naming this provider, so the port has to be
   * known before this function is called rather than discovered after.
   * Defaults to `0` (ephemeral), which is every vitest caller.
   */
  readonly port?: number
}

/** What the provider will put in the next id token it signs. */
export interface FakeIdTokenOverrides {
  readonly issuer?: string
  readonly audience?: string | readonly string[]
  readonly subject?: string
  readonly email?: string | null
  readonly emailVerified?: boolean
  readonly name?: string
  readonly expiresInSeconds?: number
  readonly extraClaims?: Readonly<Record<string, unknown>>
}

export interface FakeOidcProvider {
  readonly issuer: string
  readonly host: string
  /** An outbound-client factory that reaches this server; pass it to the harness. */
  readonly createClient: OutboundClientFactory
  /**
   * Completes an authorisation request the way a browser would: checks what
   * the platform sent, and hands back the `code` and `state` for the callback.
   */
  authorize(authorizationUrl: string): { readonly code: string; readonly state: string }
  /** What the next token exchange will return. Later calls replace earlier ones. */
  nextToken(overrides: FakeIdTokenOverrides): void
  /**
   * Replaces the signing key and republishes the set, as a provider does. A
   * platform holding the previous set then meets a token it cannot verify,
   * which is the key-rotation path.
   */
  rotateKeys(): void
  /** Every path the platform asked for, in order. */
  readonly requests: readonly string[]
  close(): Promise<void>
}

interface KeyPair {
  readonly kid: string
  readonly privateKey: KeyObject
  readonly publicJwk: Record<string, unknown>
}

function newKeyPair(kid: string): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>
  return { kid, privateKey, publicJwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } }
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function sign(key: KeyPair, claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid }))
  const payload = base64url(JSON.stringify(claims))
  const signer = createSign('sha256')
  signer.update(`${header}.${payload}`)
  return `${header}.${payload}.${signer.sign(key.privateKey).toString('base64url')}`
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * A parameter the platform always sends. A missing one is a bug in the flow
 * this fake exists to catch, not a case to paper over with a default.
 */
function parameter(values: URLSearchParams, name: string): string {
  const value = values.get(name)
  /* v8 ignore next -- see above: reaching this means the platform sent an
     incomplete request, and the test that did so should say so loudly. */
  if (value === null) throw new Error(`the request carried no ${name}`)
  return value
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(encoded)),
  })
  response.end(encoded)
}

interface PendingAuthorization {
  readonly challenge: string
  readonly redirectUri: string
  readonly nonce: string
  /**
   * Claims this one authorization attempt asserts, read from the
   * `quill_e2e_claims` cookie a real browser carried to `/authorize`
   * (`readClaimsCookie`) — never from the shared `overrides` variable below,
   * which several browsers hitting one fake provider process concurrently
   * (`e2e/sso.spec.ts`'s four profiles) would race on. `undefined` for the
   * in-process `authorize()` helper vitest uses, which falls back to
   * `overrides` exactly as it always has.
   */
  readonly claims?: FakeIdTokenOverrides
}

/**
 * The cookie a real browser carries to `/authorize`, set on this provider's
 * own origin before the browser ever navigates there
 * (`e2e/support/oidc.ts`'s `claimsCookie`), so that two browsers driving this
 * one shared fake-provider process concurrently — the four profiles
 * `e2e/sso.spec.ts` runs under — never share, and never race on, the same
 * mutable identity. Each browser context's cookie jar is its own; nothing
 * server-side is keyed by it.
 */
export const CLAIMS_COOKIE_NAME = 'quill_e2e_claims'

/**
 * The exact inverse of `readClaimsCookie` above.
 *
 * `e2e/**` imports no server code (`e2e/support/seed.ts`'s doc comment) — a
 * Playwright spec talks to a real process, started from
 * `fake-oidc-server-cli.ts`, over HTTP — so `e2e/support/oidc.ts` restates
 * this one-line encoding rather than importing it, with a comment pointing
 * back here. Exported all the same, so this module's own tests exercise the
 * identical encoding a spec produces.
 */
export function encodeClaimsCookie(overrides: FakeIdTokenOverrides): string {
  return Buffer.from(JSON.stringify(overrides), 'utf8').toString('base64url')
}

/** The exact encoding `e2e/support/oidc.ts` produces; decoded, never trusted beyond `JSON.parse`. */
function readClaimsCookie(header: string | undefined): FakeIdTokenOverrides | undefined {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== CLAIMS_COOKIE_NAME) continue
    try {
      const decoded = Buffer.from(part.slice(separator + 1).trim(), 'base64url').toString('utf8')
      return JSON.parse(decoded) as FakeIdTokenOverrides
    } catch {
      return undefined
    }
  }
  return undefined
}

export async function startFakeOidcProvider(options: FakeOidcOptions): Promise<FakeOidcProvider> {
  const hostname = 'sso.provider.test'
  let keys: KeyPair = newKeyPair('key-1')
  let generation = 1
  let overrides: FakeIdTokenOverrides = {}
  const pending = new Map<string, PendingAuthorization>()
  const requests: string[] = []
  let issued = 0

  const server: Server = createServer((request, response) => {
    void handle(request, response)
  })
  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  const issuer = `http://${hostname}:${String(port)}`
  // A real browser cannot resolve `sso.provider.test` the way the pinned
  // outbound client does (see the module doc comment): it has to be handed
  // an endpoint it can actually dial. `127.0.0.1` on the same port this
  // process is really listening on does that with no DNS involved at all,
  // and discovery.ts allows an endpoint to live on a different host from the
  // issuer's as long as it shares its scheme, which loopback http does. The
  // server itself never fetches this endpoint, only the browser does.
  const browserAuthorizationEndpoint = `http://127.0.0.1:${String(port)}/authorize`

  function discoveryDocument(): Record<string, unknown> {
    return {
      issuer,
      authorization_endpoint: browserAuthorizationEndpoint,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      token_endpoint_auth_methods_supported: options.tokenEndpointAuthMethods ?? [
        'client_secret_basic',
        'client_secret_post',
      ],
    }
  }

  function clientAuthenticated(request: IncomingMessage, form: URLSearchParams): boolean {
    const header = request.headers.authorization
    if (typeof header === 'string' && header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
      const [id = '', secret = ''] = decoded.split(':')
      return (
        decodeURIComponent(id) === options.clientId &&
        decodeURIComponent(secret) === options.clientSecret
      )
    }
    return (
      form.get('client_id') === options.clientId &&
      form.get('client_secret') === options.clientSecret
    )
  }

  function idTokenFor(authorization: PendingAuthorization): string {
    // The per-attempt cookie wins when a real browser carried one; the
    // shared `overrides` variable is what the in-process `authorize()`
    // helper and every vitest `nextToken()` call have always used, and stays
    // exactly as it was for them.
    const effective = { ...overrides, ...authorization.claims }
    const nowSeconds = Math.floor(options.now().getTime() / 1000)
    const email = effective.email === undefined ? 'ada@example.com' : effective.email
    const claims: Record<string, unknown> = {
      iss: effective.issuer ?? issuer,
      aud: effective.audience ?? options.clientId,
      sub: effective.subject ?? 'provider-subject-1',
      nonce: authorization.nonce,
      iat: nowSeconds,
      exp: nowSeconds + (effective.expiresInSeconds ?? 300),
      email_verified: effective.emailVerified ?? true,
      name: effective.name ?? 'Ada Lovelace',
      ...(email === null ? {} : { email }),
      ...effective.extraClaims,
    }
    return sign(keys, claims)
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    /* v8 ignore next -- `url` is set on every request Node hands to a handler. */
    const url = new URL(request.url ?? '/', issuer)
    requests.push(url.pathname)

    if (url.pathname === '/.well-known/openid-configuration') {
      json(response, 200, discoveryDocument())
      return
    }
    if (url.pathname === '/jwks') {
      json(response, 200, { keys: [keys.publicJwk] })
      return
    }
    if (url.pathname === '/authorize') {
      // What a real browser hits, having followed the platform's redirect
      // (`e2e/sso.spec.ts`). There is no login form: this fake signs in
      // immediately, which is the browser-visible "the provider signs the
      // person in" step, and mints a code exactly as the in-process
      // `authorize()` helper below does, plus this request's own claims
      // cookie, so the two never drift apart.
      issued += 1
      const code = `code-${String(issued)}`
      const claims = readClaimsCookie(request.headers.cookie)
      pending.set(code, {
        challenge: parameter(url.searchParams, 'code_challenge'),
        redirectUri: parameter(url.searchParams, 'redirect_uri'),
        nonce: parameter(url.searchParams, 'nonce'),
        ...(claims === undefined ? {} : { claims }),
      })
      const location = new URL(parameter(url.searchParams, 'redirect_uri'))
      location.searchParams.set('code', code)
      location.searchParams.set('state', parameter(url.searchParams, 'state'))
      response.writeHead(302, { location: location.href })
      response.end()
      return
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(await readBody(request))
      if (!clientAuthenticated(request, form)) {
        json(response, 401, { error: 'invalid_client' })
        return
      }
      const code = parameter(form, 'code')
      const authorization = pending.get(code)
      if (authorization === undefined) {
        json(response, 400, { error: 'invalid_grant' })
        return
      }
      // Single use, as a code must be.
      pending.delete(code)
      if (parameter(form, 'redirect_uri') !== authorization.redirectUri) {
        json(response, 400, { error: 'invalid_grant' })
        return
      }
      if (base64url(sha256(parameter(form, 'code_verifier'))) !== authorization.challenge) {
        json(response, 400, { error: 'invalid_grant' })
        return
      }
      json(response, 200, {
        access_token: 'fake-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: idTokenFor(authorization),
      })
      return
    }
    json(response, 404, { error: 'not_found' })
  }

  return {
    issuer,
    host: hostname,

    /**
     * Resolves this provider's name to a public address and then dials the
     * loopback port it really listens on — see the note at the top of this
     * file.
     */
    createClient: (allowedHosts) =>
      createOutboundClient({
        allowedHosts,
        resolve: async () => [PUBLIC_TEST_ADDRESS],
        fetch: async (url, init) => {
          const target = new URL(url)
          target.hostname = '127.0.0.1'
          target.port = String(port)
          return nodeFetch(target.href, { ...init, addresses: ['127.0.0.1'] })
        },
      }),

    authorize(authorizationUrl) {
      const query = new URL(authorizationUrl).searchParams
      issued += 1
      const code = `code-${String(issued)}`
      pending.set(code, {
        challenge: parameter(query, 'code_challenge'),
        redirectUri: parameter(query, 'redirect_uri'),
        nonce: parameter(query, 'nonce'),
      })
      return { code, state: parameter(query, 'state') }
    },

    nextToken(next) {
      overrides = next
    },

    rotateKeys() {
      generation += 1
      keys = newKeyPair(`key-${String(generation)}`)
    },

    requests,

    async close() {
      // The outbound client's transport uses Node's keep-alive agent, so a
      // plain `close()` would wait for idle sockets that never close.
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    },
  }
}

/** The same digest the platform's PKCE helper computes over the verifier. */
function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'ascii').digest()
}
