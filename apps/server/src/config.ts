import { BRAND } from '@quill/brand'

/**
 * Server configuration, read once from the environment.
 *
 * Every variable is documented in `.env.example`. Secrets never have
 * defaults, except in the `dev` mailer driver, which never sends mail.
 */
export interface ServerConfig {
  readonly host: string
  readonly port: number
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
  /** Base URL used to build absolute links (magic links, share links). */
  readonly appUrl: string
  /**
   * The scheme-host-port of `appUrl`, precomputed: what an `Origin` header
   * has to match on a state-changing request (ADR-011 CSRF).
   */
  readonly appOrigin: string
  /** True when `appUrl` is `https:`, which is what HSTS and `__Host-` cookies turn on. */
  readonly https: boolean
  /** Serves the Swagger UI; development only, so a deployment never publishes its route map. */
  readonly serveApiDocs: boolean
  readonly databaseUrl: string
  /**
   * What Fastify is told to trust in `X-Forwarded-For` (ADR-011 assumes TLS
   * and a proxy at the edge). `false` unless `TRUST_PROXY` says otherwise,
   * because believing the header from an untrusted peer hands every client a
   * free source address and with it an unlimited rate-limit budget.
   */
  readonly trustProxy: TrustProxyConfig
  readonly session: SessionConfig
  readonly rateLimit: RateLimitConfig
  readonly breachedPasswords: BreachedPasswordConfig
  readonly mailer: MailerConfig
  readonly contentStore: ContentStoreConfig
}

/**
 * Where published content lives (ADR-014). `filesystem` is the default
 * self-host backend: one bare repository per workspace under
 * `CONTENT_STORE_PATH`, readable by the `git` CLI. `memory` keeps the same
 * layout in process and is for tests and throwaway instances.
 */
export type ContentStoreConfig =
  | { readonly driver: 'filesystem'; readonly path: string }
  | { readonly driver: 'memory' }

/**
 * `false` (trust nothing), a hop count from the socket inwards, or the exact
 * proxy addresses and CIDR ranges to believe — Fastify's own `trustProxy`
 * vocabulary, narrowed to the forms an operator can state in one variable.
 */
export type TrustProxyConfig = false | number | readonly string[]

export interface SessionConfig {
  readonly cookieName: string
  /**
   * The short-lived cookie that binds a magic link to the browser that asked
   * for it (ADR-011). Derived from the session cookie's name, so an instance
   * that carries the `__Host-` prefix on one carries it on both.
   */
  readonly linkCookieName: string
  /**
   * Absolute lifetime: a session dies this long after it was issued however
   * busy it has been (ADR-011: 30 days).
   */
  readonly ttlMs: number
  /**
   * Idle lifetime: a session dies this long after its last request
   * (ADR-011: 7 days). Enforced server-side against `last_seen_at`, never
   * by the cookie's own expiry, which a client controls.
   */
  readonly idleTtlMs: number
  /** Sent only over HTTPS; derived from the scheme of `appUrl` (ADR-011). */
  readonly secureCookie: boolean
}

/**
 * Abuse resistance on the authentication endpoints (ADR-011): a short window
 * that *grows* for a key that keeps failing, rather than a hard lockout an
 * attacker could aim at a victim's account.
 */
export interface RateLimitConfig {
  /** Requests allowed per window, per key. */
  readonly max: number
  /** The first window. Each consecutive exhausted window doubles it. */
  readonly windowMs: number
  /** The window stops doubling here, so a key always recovers. */
  readonly maxWindowMs: number
}

export interface BreachedPasswordConfig {
  /** Off only for an air-gapped instance; the check fails open either way. */
  readonly enabled: boolean
  /** The k-anonymity range endpoint, and the only host the checker may reach. */
  readonly rangeApiUrl: string
}

export type MailerConfig =
  | { readonly driver: 'dev' }
  | {
      readonly driver: 'smtp'
      readonly host: string
      readonly port: number
      readonly secure: boolean
      readonly from: string
      readonly user?: string
      readonly pass?: string
    }

/** Where a configuration warning goes. Injected so a test can capture it. */
export interface ConfigWarn {
  (message: string): void
}

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])

const DEFAULT_CONTENT_STORE_PATH = './data/content'

function loadContentStoreConfig(env: NodeJS.ProcessEnv): ContentStoreConfig {
  const driver = env['CONTENT_STORE'] ?? 'filesystem'
  if (driver === 'memory') return { driver: 'memory' }
  if (driver !== 'filesystem') {
    throw new Error(`CONTENT_STORE must be "filesystem" or "memory", received "${driver}"`)
  }
  const path = env['CONTENT_STORE_PATH'] ?? DEFAULT_CONTENT_STORE_PATH
  if (path.length === 0) {
    throw new Error('CONTENT_STORE_PATH must not be empty when CONTENT_STORE=filesystem')
  }
  return { driver: 'filesystem', path }
}

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Local development default; every deployment sets DATABASE_URL explicitly. */
const DEFAULT_DATABASE_URL = `postgres://${BRAND.slug}:${BRAND.slug}@localhost:5432/${BRAND.slug}`

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  max: 10,
  windowMs: 60_000,
  maxWindowMs: 60 * 60_000,
}

const HIBP_RANGE_API_URL = 'https://api.pwnedpasswords.com/range'

/**
 * The only hosts ADR-011 lets the session cookie travel to without TLS.
 * `URL.hostname` keeps an IPv6 literal's brackets, so both spellings are here.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function parsePort(raw: string | undefined, variable: string, fallback: number): number {
  const port = Number(raw ?? String(fallback))
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${variable} must be an integer between 1 and 65535, received "${raw}"`)
  }
  return port
}

function parseDuration(raw: string | undefined, variable: string, fallback: number): number {
  const value = Number(raw ?? String(fallback))
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${variable} must be a positive integer, received "${raw}"`)
  }
  return value
}

function parseAppUrl(raw: string): URL {
  try {
    return new URL(raw)
  } catch {
    throw new Error(`APP_URL must be an absolute URL, received "${raw}"`)
  }
}

/**
 * Cookie security follows the app's own scheme, never `NODE_ENV` — a
 * deployment that forgets one environment variable must not silently ship
 * session cookies over plaintext HTTP (ADR-011).
 */
function loadSessionConfig(env: NodeJS.ProcessEnv, appUrl: URL, warn: ConfigWarn): SessionConfig {
  const https = appUrl.protocol === 'https:'
  if (!https && !LOOPBACK_HOSTS.has(appUrl.hostname)) {
    throw new Error(
      `APP_URL must use https: outside local development, received "${appUrl.href}". ` +
        'Plain http is permitted only for localhost (ADR-011).',
    )
  }

  const override = env['SECURE_COOKIES']
  if (override !== undefined) {
    warn(
      'SECURE_COOKIES is deprecated and will be removed: the session cookie now takes its ' +
        "Secure flag from APP_URL's scheme (ADR-011). Remove it and set APP_URL instead.",
    )
  }
  // An https instance keeps `Secure` whatever the override says. Turning it
  // off there would put the session cookie on the wire in plaintext on the
  // first http request a browser is tricked into making, which is exactly the
  // attack the flag exists to stop — so the override may only ever narrow
  // downwards, on an instance that has no TLS to lose.
  if (https && override === 'false') {
    warn(
      'SECURE_COOKIES=false is ignored on an https instance: the session cookie keeps its ' +
        'Secure flag (ADR-011).',
    )
  }
  const secureCookie = override === undefined || https ? https : override === 'true'

  const cookieName = env['SESSION_COOKIE_NAME']
  if (cookieName !== undefined && secureCookie && !cookieName.startsWith('__Host-')) {
    throw new Error(
      `SESSION_COOKIE_NAME must start with "__Host-" on a secure instance, received "${cookieName}". ` +
        'The prefix is what makes the browser enforce Secure, Path=/ and no Domain (ADR-011).',
    )
  }

  return {
    // `__Host-` is what makes the browser enforce Secure, Path=/ and no
    // Domain, so it is only correct on a cookie that really is Secure.
    cookieName:
      cookieName ?? (secureCookie ? `__Host-${BRAND.slug}_session` : `${BRAND.slug}_session`),
    linkCookieName: secureCookie ? `__Host-${BRAND.slug}_link` : `${BRAND.slug}_link`,
    ttlMs: parseDuration(env['SESSION_TTL_MS'], 'SESSION_TTL_MS', DEFAULT_SESSION_TTL_MS),
    idleTtlMs: parseDuration(
      env['SESSION_IDLE_TTL_MS'],
      'SESSION_IDLE_TTL_MS',
      DEFAULT_SESSION_IDLE_TTL_MS,
    ),
    secureCookie,
  }
}

function loadRateLimitConfig(env: NodeJS.ProcessEnv): RateLimitConfig {
  return {
    max: parseDuration(env['AUTH_RATE_LIMIT_MAX'], 'AUTH_RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT.max),
    windowMs: parseDuration(
      env['AUTH_RATE_LIMIT_WINDOW_MS'],
      'AUTH_RATE_LIMIT_WINDOW_MS',
      DEFAULT_RATE_LIMIT.windowMs,
    ),
    maxWindowMs: parseDuration(
      env['AUTH_RATE_LIMIT_MAX_WINDOW_MS'],
      'AUTH_RATE_LIMIT_MAX_WINDOW_MS',
      DEFAULT_RATE_LIMIT.maxWindowMs,
    ),
  }
}

/**
 * `TRUST_PROXY`, in the three forms an operator actually has: nothing (the
 * default: trust no forwarding header at all), a hop count, or a list of
 * proxy addresses and CIDR ranges.
 *
 * Rate limiting keys on the source address (ADR-011), so a forwarded header
 * believed from an untrusted peer is not a logging nicety — it is a way to
 * spend an unlimited budget from one host.
 */
function loadTrustProxyConfig(env: NodeJS.ProcessEnv): TrustProxyConfig {
  const raw = env['TRUST_PROXY']
  if (raw === undefined || raw.length === 0 || raw === 'false') return false
  if (raw === 'true') {
    throw new Error(
      'TRUST_PROXY=true would believe X-Forwarded-For from any peer. Set the number of ' +
        'proxies in front of this server, or the addresses and CIDR ranges to trust (ADR-011).',
    )
  }
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw)
    if (hops < 1) {
      throw new Error(`TRUST_PROXY must name at least one hop, received "${raw}"`)
    }
    return hops
  }
  const addresses = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (addresses.length === 0) {
    throw new Error(`TRUST_PROXY must be a hop count or a list of addresses, received "${raw}"`)
  }
  return addresses
}

function loadMailerConfig(env: NodeJS.ProcessEnv): MailerConfig {
  const driver = env['MAIL_DRIVER'] ?? 'dev'
  if (driver === 'dev') {
    return { driver: 'dev' }
  }
  if (driver !== 'smtp') {
    throw new Error(`MAIL_DRIVER must be "dev" or "smtp", received "${driver}"`)
  }

  const host = env['SMTP_HOST']
  const from = env['SMTP_FROM']
  if (host === undefined || host.length === 0) {
    throw new Error('SMTP_HOST is required when MAIL_DRIVER=smtp')
  }
  if (from === undefined || from.length === 0) {
    throw new Error('SMTP_FROM is required when MAIL_DRIVER=smtp')
  }

  const user = env['SMTP_USER']
  const pass = env['SMTP_PASS']
  return {
    driver: 'smtp',
    host,
    port: parsePort(env['SMTP_PORT'], 'SMTP_PORT', 587),
    secure: env['SMTP_SECURE'] === 'true',
    from,
    ...(user === undefined ? {} : { user }),
    ...(pass === undefined ? {} : { pass }),
  }
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  warn: ConfigWarn = (message) => process.emitWarning(message),
): ServerConfig {
  const port = parsePort(env['PORT'], 'PORT', 3000)

  const logLevel = env['LOG_LEVEL'] ?? 'info'
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error(
      `LOG_LEVEL must be one of ${[...LOG_LEVELS].join(', ')}, received "${logLevel}"`,
    )
  }

  const appUrl = parseAppUrl(env['APP_URL'] ?? `http://localhost:${port}`)

  const production = env['NODE_ENV'] === 'production'
  const databaseUrl = env['DATABASE_URL']
  // Two defaults that are right on a laptop and dangerous anywhere else. A
  // production instance that silently pointed at a local database, or logged
  // live sign-in links to stdout, would be a data-loss or a credential
  // incident rather than a misconfiguration — so it refuses to boot, in the
  // same shape as the plain-http refusal above.
  if (production && (databaseUrl === undefined || databaseUrl.length === 0)) {
    throw new Error(
      'DATABASE_URL is required under NODE_ENV=production: the localhost default is for ' +
        'local development only.',
    )
  }
  const mailer = loadMailerConfig(env)
  if (production && mailer.driver === 'dev') {
    throw new Error(
      'MAIL_DRIVER=dev logs sign-in, verification and reset links to stdout and is for local ' +
        'development only. Set MAIL_DRIVER=smtp under NODE_ENV=production (ADR-011).',
    )
  }

  return {
    host: env['HOST'] ?? '0.0.0.0',
    port,
    logLevel: logLevel as ServerConfig['logLevel'],
    appUrl: appUrl.href.replace(/\/$/, ''),
    appOrigin: appUrl.origin,
    https: appUrl.protocol === 'https:',
    serveApiDocs: env['NODE_ENV'] !== 'production',
    databaseUrl: databaseUrl ?? DEFAULT_DATABASE_URL,
    trustProxy: loadTrustProxyConfig(env),
    session: loadSessionConfig(env, appUrl, warn),
    rateLimit: loadRateLimitConfig(env),
    breachedPasswords: {
      enabled: env['BREACHED_PASSWORD_CHECK'] !== 'false',
      rangeApiUrl: env['BREACHED_PASSWORD_RANGE_URL'] ?? HIBP_RANGE_API_URL,
    },
    mailer,
    contentStore: loadContentStoreConfig(env),
  }
}
