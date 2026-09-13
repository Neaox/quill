import { describe, expect, it } from 'vitest'

import { BRAND } from '@quill/brand'

import { loadConfig } from './config.ts'

/**
 * The smallest environment a production instance can legitimately boot in:
 * https, a real database, and real mail. `config.ts` refuses the defaults
 * for the last two under `NODE_ENV=production` (review finding M12), so every
 * production-shaped test starts from here.
 */
const A_KEY = Buffer.alloc(32, 1).toString('base64')
const ANOTHER_KEY = Buffer.alloc(32, 2).toString('base64')

const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://x:y@db:5432/quill',
  MAIL_DRIVER: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  SMTP_FROM: 'noreply@example.com',
  QUILL_MASTER_KEY: A_KEY,
}

describe('loadConfig', () => {
  it('applies defaults when the environment is empty', () => {
    expect(loadConfig({}, () => undefined)).toEqual({
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      appUrl: 'http://localhost:3000',
      appOrigin: 'http://localhost:3000',
      https: false,
      serveApiDocs: true,
      databaseUrl: 'postgres://quill:quill@localhost:5432/quill',
      trustProxy: false,
      session: {
        cookieName: `${BRAND.slug}_session`,
        linkCookieName: `${BRAND.slug}_link`,
        ttlMs: 30 * 24 * 60 * 60 * 1000,
        idleTtlMs: 7 * 24 * 60 * 60 * 1000,
        secureCookie: false,
      },
      rateLimit: { max: 10, windowMs: 60_000, maxWindowMs: 60 * 60_000 },
      searchRateLimitMax: 60,
      breachedPasswords: {
        enabled: true,
        rangeApiUrl: 'https://api.pwnedpasswords.com/range',
      },
      mailer: { driver: 'dev' },
      contentStore: { driver: 'filesystem', path: './data/content' },
      shareLinks: { enabled: true },
      masterKey: { driver: 'environment', keys: [Buffer.alloc(32).toString('base64')] },
    })
  })

  it('reads HOST, PORT, and LOG_LEVEL', () => {
    const config = loadConfig({ HOST: '127.0.0.1', PORT: '8080', LOG_LEVEL: 'debug' })
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(8080)
    expect(config.logLevel).toBe('debug')
  })

  it('defaults appUrl from the resolved port when APP_URL is unset', () => {
    expect(loadConfig({ PORT: '4000' }).appUrl).toBe('http://localhost:4000')
  })

  it('reads an explicit APP_URL, DATABASE_URL, and SESSION_COOKIE_NAME', () => {
    const config = loadConfig({
      APP_URL: 'https://docs.example.com',
      DATABASE_URL: 'postgres://x:y@db:5432/quill',
      SESSION_COOKIE_NAME: '__Host-custom_session',
      SESSION_TTL_MS: '1000',
      QUILL_MASTER_KEY: A_KEY,
    })
    expect(config.appUrl).toBe('https://docs.example.com')
    expect(config.databaseUrl).toBe('postgres://x:y@db:5432/quill')
    expect(config.session).toEqual({
      cookieName: '__Host-custom_session',
      linkCookieName: `__Host-${BRAND.slug}_link`,
      ttlMs: 1000,
      idleTtlMs: 7 * 24 * 60 * 60 * 1000,
      secureCookie: true,
    })
  })

  // ADR-011 / review finding 9: the cookie's Secure flag follows the app's
  // own scheme. NODE_ENV is a deployment convention, not a statement about
  // transport, and trusting it is how a real deployment ships sessions in
  // the clear.
  describe('cookie security', () => {
    it('derives Secure and the __Host- prefix from an https APP_URL', () => {
      const config = loadConfig({ APP_URL: 'https://app.example.com', QUILL_MASTER_KEY: A_KEY })
      expect(config.session.secureCookie).toBe(true)
      expect(config.session.cookieName).toBe(`__Host-${BRAND.slug}_session`)
      expect(config.https).toBe(true)
      expect(config.appOrigin).toBe('https://app.example.com')
    })

    it('allows a non-secure cookie only for localhost', () => {
      expect(loadConfig({ APP_URL: 'http://localhost:3000' }).session.secureCookie).toBe(false)
      expect(loadConfig({ APP_URL: 'http://127.0.0.1:3000' }).session.secureCookie).toBe(false)
      expect(loadConfig({ APP_URL: 'http://[::1]:3000' }).session.secureCookie).toBe(false)
      expect(loadConfig({ APP_URL: 'http://localhost:3000' }).session.cookieName).toBe(
        `${BRAND.slug}_session`,
      )
    })

    it('refuses plain http for anything but localhost', () => {
      expect(() => loadConfig({ APP_URL: 'http://app.example.com' })).toThrow(
        /must use https: outside local development/,
      )
    })

    it('ignores NODE_ENV entirely', () => {
      expect(loadConfig(PRODUCTION).session.secureCookie).toBe(false)
      expect(
        loadConfig({ APP_URL: 'https://app.example.com', QUILL_MASTER_KEY: A_KEY }).session
          .secureCookie,
      ).toBe(true)
    })

    it('still honours the deprecated SECURE_COOKIES, with a warning', () => {
      const warnings: string[] = []
      const warn = (message: string): void => void warnings.push(message)

      expect(
        loadConfig({ SECURE_COOKIES: 'true', QUILL_MASTER_KEY: A_KEY }, warn).session.secureCookie,
      ).toBe(true)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toMatch(/SECURE_COOKIES is deprecated/)
    })

    /**
     * Review finding M14: the override may narrow, never widen. An https
     * instance that honoured `SECURE_COOKIES=false` would put its session
     * cookie on the wire in the clear on the first http request a browser
     * could be tricked into making — the exact attack the flag prevents.
     */
    it('ignores SECURE_COOKIES=false on an https instance, and says so', () => {
      const warnings: string[] = []
      const warn = (message: string): void => void warnings.push(message)
      const config = loadConfig(
        { APP_URL: 'https://app.example.com', SECURE_COOKIES: 'false', QUILL_MASTER_KEY: A_KEY },
        warn,
      )

      expect(config.session.secureCookie).toBe(true)
      expect(config.session.cookieName).toBe(`__Host-${BRAND.slug}_session`)
      expect(warnings.some((message) => /SECURE_COOKIES=false is ignored/.test(message))).toBe(true)
    })

    /** Likewise M14: the prefix is a promise the browser enforces. */
    it('refuses a cookie name without the __Host- prefix on a secure instance', () => {
      expect(() =>
        loadConfig({
          APP_URL: 'https://app.example.com',
          SESSION_COOKIE_NAME: 'custom_session',
          QUILL_MASTER_KEY: A_KEY,
        }),
      ).toThrow(/must start with "__Host-"/)
      // On a plain-http localhost instance there is no promise to break.
      expect(loadConfig({ SESSION_COOKIE_NAME: 'custom_session' }).session.cookieName).toBe(
        'custom_session',
      )
    })

    it('warns through process.emitWarning when no sink is given', async () => {
      // Warnings are delivered on the next tick and this process emits more
      // than one of them, so wait for the one this test is about rather than
      // for whichever arrives first.
      const emitted = new Promise<string>((resolve) => {
        const listener = (warning: Error): void => {
          if (!/SECURE_COOKIES is deprecated/.test(warning.message)) return
          process.off('warning', listener)
          resolve(warning.message)
        }
        process.on('warning', listener)
      })
      loadConfig({ SECURE_COOKIES: 'true', QUILL_MASTER_KEY: A_KEY })
      expect(await emitted).toMatch(/SECURE_COOKIES is deprecated/)
    })

    it('rejects an APP_URL that is not a URL', () => {
      expect(() => loadConfig({ APP_URL: 'not a url' })).toThrow(/must be an absolute URL/)
    })
  })

  it('serves the API docs everywhere but production', () => {
    expect(loadConfig({}, () => undefined).serveApiDocs).toBe(true)
    expect(loadConfig(PRODUCTION).serveApiDocs).toBe(false)
  })

  /**
   * Review findings M12: two defaults that are right on a laptop and
   * dangerous anywhere else. A production instance silently pointing at a
   * local database, or logging live sign-in links to stdout, is an incident
   * rather than a misconfiguration.
   */
  describe('refusing to boot on an unsafe production combination', () => {
    it('requires DATABASE_URL under NODE_ENV=production', () => {
      const { DATABASE_URL: _url, ...withoutDatabase } = PRODUCTION
      expect(() => loadConfig(withoutDatabase)).toThrow(/DATABASE_URL is required/)
    })

    it('refuses the dev mailer under NODE_ENV=production', () => {
      expect(() => loadConfig({ ...PRODUCTION, MAIL_DRIVER: 'dev' })).toThrow(
        /MAIL_DRIVER=dev logs sign-in/,
      )
      // And with no MAIL_DRIVER at all, because the default is `dev`.
      const { MAIL_DRIVER: _driver, ...withoutMailer } = PRODUCTION
      expect(() => loadConfig(withoutMailer)).toThrow(/MAIL_DRIVER=dev logs sign-in/)
    })

    it('requires QUILL_MASTER_KEY under NODE_ENV=production', () => {
      const { QUILL_MASTER_KEY: _key, ...withoutKey } = PRODUCTION
      expect(() => loadConfig(withoutKey)).toThrow(/QUILL_MASTER_KEY is required/)
    })

    it('boots when both are set properly', () => {
      expect(loadConfig(PRODUCTION).mailer).toMatchObject({ driver: 'smtp' })
    })
  })

  /**
   * The master key wraps every secret entered in the product (ADR-034). It is
   * the one thing a restore cannot rebuild from the content store, so
   * production states it or refuses to start, and a laptop gets an obviously
   * worthless key and a warning.
   */
  describe('QUILL_MASTER_KEY', () => {
    it('falls back to the all-zero development key, loudly', () => {
      const warnings: string[] = []
      const config = loadConfig({}, (message) => void warnings.push(message))
      expect(config.masterKey).toEqual({
        driver: 'environment',
        keys: [Buffer.alloc(32).toString('base64')],
      })
      expect(warnings.some((message) => /QUILL_MASTER_KEY is unset/.test(message))).toBe(true)
    })

    it('reads the current key and says nothing', () => {
      const warnings: string[] = []
      const config = loadConfig(
        { QUILL_MASTER_KEY: A_KEY },
        (message) => void warnings.push(message),
      )
      expect(config.masterKey).toEqual({ driver: 'environment', keys: [A_KEY] })
      expect(warnings).toEqual([])
    })

    it('keeps retired keys after the current one, so a rotation can unwrap', () => {
      const config = loadConfig({
        QUILL_MASTER_KEY: A_KEY,
        QUILL_MASTER_KEY_PREVIOUS: ` ${ANOTHER_KEY} , `,
      })
      expect(config.masterKey).toEqual({ driver: 'environment', keys: [A_KEY, ANOTHER_KEY] })
    })

    /**
     * The "real deployment" signal is the app's own URL, not `NODE_ENV`: the
     * same source the session cookie takes its `Secure` flag from (ADR-011),
     * so an instance cannot be strict about its cookies and lax about the key
     * that wraps every secret in it.
     */
    it('requires a key on any instance that is not loopback, whatever NODE_ENV says', () => {
      expect(() => loadConfig({ APP_URL: 'https://docs.example.com' })).toThrow(
        /required on an instance serving "docs.example.com"/,
      )
      // No NODE_ENV at all: the URL is the whole signal.
      expect(() =>
        loadConfig({ APP_URL: 'https://docs.example.com', QUILL_MASTER_KEY: A_KEY }),
      ).not.toThrow()
    })

    it('refuses the published development key by value on a real deployment', () => {
      const developmentKey = Buffer.alloc(32).toString('base64')
      expect(() =>
        loadConfig({ APP_URL: 'https://docs.example.com', QUILL_MASTER_KEY: developmentKey }),
      ).toThrow(/all-zero development key/)
      expect(() => loadConfig({ ...PRODUCTION, QUILL_MASTER_KEY: developmentKey })).toThrow(
        /all-zero development key/,
      )
      // On a laptop it is exactly what is expected, stated or not.
      expect(() => loadConfig({ QUILL_MASTER_KEY: developmentKey }, () => undefined)).not.toThrow()
    })

    it('reads a key file instead when the driver says so', () => {
      expect(
        loadConfig({ MASTER_KEY_DRIVER: 'file', QUILL_MASTER_KEY_FILE: '/run/secrets/key' }),
      ).toMatchObject({ masterKey: { driver: 'file', path: '/run/secrets/key' } })
    })

    it('refuses a file driver with no file', () => {
      expect(() => loadConfig({ MASTER_KEY_DRIVER: 'file' })).toThrow(
        /QUILL_MASTER_KEY_FILE is required/,
      )
      expect(() => loadConfig({ MASTER_KEY_DRIVER: 'file', QUILL_MASTER_KEY_FILE: '' })).toThrow(
        /QUILL_MASTER_KEY_FILE is required/,
      )
    })

    it('refuses a driver it does not have', () => {
      expect(() => loadConfig({ MASTER_KEY_DRIVER: 'kms' })).toThrow(
        /MASTER_KEY_DRIVER must be "environment" or "file"/,
      )
    })
  })

  /**
   * Review finding H7: `request.ip` is what the rate limiter keys on, so a
   * forwarded header believed from an untrusted peer is an unlimited budget
   * from a single host.
   */
  describe('TRUST_PROXY', () => {
    it('trusts nothing by default', () => {
      expect(loadConfig({}).trustProxy).toBe(false)
      expect(loadConfig({ TRUST_PROXY: '' }).trustProxy).toBe(false)
      expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false)
    })

    it('reads a hop count', () => {
      expect(loadConfig({ TRUST_PROXY: '2' }).trustProxy).toBe(2)
    })

    it('reads a list of addresses and CIDR ranges', () => {
      expect(loadConfig({ TRUST_PROXY: '10.0.0.1, 192.168.0.0/16 ' }).trustProxy).toEqual([
        '10.0.0.1',
        '192.168.0.0/16',
      ])
    })

    it('refuses the blanket "true", which would believe any peer', () => {
      expect(() => loadConfig({ TRUST_PROXY: 'true' })).toThrow(/would believe X-Forwarded-For/)
    })

    it('refuses a hop count of zero', () => {
      expect(() => loadConfig({ TRUST_PROXY: '0' })).toThrow(/at least one hop/)
    })

    it('refuses a list that names nothing', () => {
      expect(() => loadConfig({ TRUST_PROXY: ' , , ' })).toThrow(/hop count or a list of addresses/)
    })
  })

  it('reads the session idle timeout and the rate-limit window', () => {
    const config = loadConfig({
      SESSION_IDLE_TTL_MS: '5000',
      AUTH_RATE_LIMIT_MAX: '3',
      AUTH_RATE_LIMIT_WINDOW_MS: '1000',
      AUTH_RATE_LIMIT_MAX_WINDOW_MS: '8000',
    })
    expect(config.session.idleTtlMs).toBe(5000)
    expect(config.rateLimit).toEqual({ max: 3, windowMs: 1000, maxWindowMs: 8000 })
  })

  it('rejects a non-positive idle timeout', () => {
    expect(() => loadConfig({ SESSION_IDLE_TTL_MS: '0' })).toThrow(
      /SESSION_IDLE_TTL_MS must be a positive integer/,
    )
  })

  it('can turn the breached-password check off and point it elsewhere', () => {
    const config = loadConfig({
      BREACHED_PASSWORD_CHECK: 'false',
      BREACHED_PASSWORD_RANGE_URL: 'https://corpus.example.com/range',
    })
    expect(config.breachedPasswords).toEqual({
      enabled: false,
      rangeApiUrl: 'https://corpus.example.com/range',
    })
  })

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT must be an integer/)
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT must be an integer/)
  })

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL must be one of/)
  })

  it('rejects a non-positive SESSION_TTL_MS', () => {
    expect(() => loadConfig({ SESSION_TTL_MS: '0' })).toThrow(
      /SESSION_TTL_MS must be a positive integer/,
    )
    expect(() => loadConfig({ SESSION_TTL_MS: 'nope' })).toThrow(
      /SESSION_TTL_MS must be a positive integer/,
    )
  })

  describe('mailer', () => {
    it('defaults to the dev driver', () => {
      expect(loadConfig({}).mailer).toEqual({ driver: 'dev' })
    })

    it('rejects an unknown MAIL_DRIVER', () => {
      expect(() => loadConfig({ MAIL_DRIVER: 'carrier-pigeon' })).toThrow(
        /MAIL_DRIVER must be "dev" or "smtp"/,
      )
    })

    it('requires SMTP_HOST and SMTP_FROM for the smtp driver', () => {
      expect(() => loadConfig({ MAIL_DRIVER: 'smtp' })).toThrow(/SMTP_HOST is required/)
      expect(() => loadConfig({ MAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.example.com' })).toThrow(
        /SMTP_FROM is required/,
      )
    })

    it('reads a full smtp configuration', () => {
      const config = loadConfig({
        MAIL_DRIVER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '2525',
        SMTP_SECURE: 'true',
        SMTP_FROM: 'docs@example.com',
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
      })
      expect(config.mailer).toEqual({
        driver: 'smtp',
        host: 'smtp.example.com',
        port: 2525,
        secure: true,
        from: 'docs@example.com',
        user: 'user',
        pass: 'pass',
      })
    })

    it('defaults smtp port and secure, and omits credentials when unset', () => {
      const config = loadConfig({
        MAIL_DRIVER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_FROM: 'docs@example.com',
      })
      expect(config.mailer).toEqual({
        driver: 'smtp',
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'docs@example.com',
      })
    })
  })
})

describe('loadConfig: the content store', () => {
  it('keeps documents in memory when asked to', () => {
    expect(loadConfig({ CONTENT_STORE: 'memory' }).contentStore).toEqual({ driver: 'memory' })
  })

  it('takes the filesystem path from the environment', () => {
    expect(
      loadConfig({ CONTENT_STORE: 'filesystem', CONTENT_STORE_PATH: '/srv/quill' }).contentStore,
    ).toEqual({ driver: 'filesystem', path: '/srv/quill' })
  })

  it('refuses a backend it does not have, and a filesystem backend with nowhere to write', () => {
    expect(() => loadConfig({ CONTENT_STORE: 's3' })).toThrow(/CONTENT_STORE must be/)
    expect(() => loadConfig({ CONTENT_STORE_PATH: '' })).toThrow(/CONTENT_STORE_PATH/)
  })
})

describe('loadConfig: share links', () => {
  it('allows share links unless the deployment says otherwise', () => {
    expect(loadConfig({}).shareLinks).toEqual({ enabled: true })
    expect(loadConfig({ SHARE_LINKS: 'on' }).shareLinks).toEqual({ enabled: true })
  })

  it('closes them for an organisation that does not want them', () => {
    expect(loadConfig({ SHARE_LINKS: 'off' }).shareLinks).toEqual({ enabled: false })
  })

  it('refuses a value that is neither, rather than guessing which was meant', () => {
    expect(() => loadConfig({ SHARE_LINKS: 'false' })).toThrow(/SHARE_LINKS must be/)
  })
})
