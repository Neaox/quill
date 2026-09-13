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
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  const issuer = `http://${hostname}:${String(port)}`

  function discoveryDocument(): Record<string, unknown> {
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
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
    const nowSeconds = Math.floor(options.now().getTime() / 1000)
    const email = overrides.email === undefined ? 'ada@example.com' : overrides.email
    const claims: Record<string, unknown> = {
      iss: overrides.issuer ?? issuer,
      aud: overrides.audience ?? options.clientId,
      sub: overrides.subject ?? 'provider-subject-1',
      nonce: authorization.nonce,
      iat: nowSeconds,
      exp: nowSeconds + (overrides.expiresInSeconds ?? 300),
      email_verified: overrides.emailVerified ?? true,
      name: overrides.name ?? 'Ada Lovelace',
      ...(email === null ? {} : { email }),
      ...overrides.extraClaims,
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
