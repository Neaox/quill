import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SecretResolver } from '../infrastructure/secrets/resolve-secret.ts'

const sendMail = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
const createTransport = vi
  .fn<(...args: unknown[]) => { sendMail: typeof sendMail }>()
  .mockReturnValue({ sendMail })

vi.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransport(...args),
}))

const { createSmtpMailer } = await import('./smtp-mailer.ts')

/** Never asked, in a test with no `user` configured. */
const UNUSED_SECRET_RESOLVER: SecretResolver = {
  /* v8 ignore next 3 */
  async resolve() {
    throw new Error('not exercised: no SMTP user is configured')
  },
}

function envFallbackResolver(): SecretResolver {
  return {
    async resolve(fallback) {
      return fallback.envValue === undefined
        ? { ok: false, reason: 'not-found' }
        : { ok: true, value: fallback.envValue }
    },
  }
}

describe('createSmtpMailer', () => {
  afterEach(() => {
    createTransport.mockClear()
    sendMail.mockClear()
  })

  it('configures the transport without auth when no user is given', async () => {
    const mailer = createSmtpMailer(
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'docs@example.com',
        passwordSecretName: 'smtp/password',
      },
      UNUSED_SECRET_RESOLVER,
    )
    await mailer.sendAccountExists({ to: 'ada@example.com', signInUrl: 'https://example.com/' })

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
    })
  })

  it('resolves the password at send time and configures the transport with auth', async () => {
    const mailer = createSmtpMailer(
      {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        from: 'docs@example.com',
        user: 'user',
        passwordSecretName: 'smtp/password',
      },
      {
        async resolve() {
          return { ok: true, value: 'from-the-secrets-store' }
        },
      },
    )
    await mailer.sendAccountExists({ to: 'ada@example.com', signInUrl: 'https://example.com/' })

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'user', pass: 'from-the-secrets-store' },
    })
  })

  it('falls back to SMTP_PASS when the secrets store holds nothing', async () => {
    const mailer = createSmtpMailer(
      {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        from: 'docs@example.com',
        user: 'user',
        passwordSecretName: 'smtp/password',
        passwordEnvValue: 'the-env-password',
      },
      envFallbackResolver(),
    )
    await mailer.sendAccountExists({ to: 'ada@example.com', signInUrl: 'https://example.com/' })

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'user', pass: 'the-env-password' } }),
    )
  })

  it('refuses to send when a user is configured but neither the store nor the environment names a password', async () => {
    const mailer = createSmtpMailer(
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'docs@example.com',
        user: 'user',
        passwordSecretName: 'smtp/password',
      },
      envFallbackResolver(),
    )

    await expect(
      mailer.sendAccountExists({ to: 'ada@example.com', signInUrl: 'https://example.com/' }),
    ).rejects.toThrow(/the SMTP password is not configured/)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it.each([
    ['sign-in', 'Your sign-in link'],
    ['email-verification', 'Verify your email address'],
    ['password-reset', 'Reset your password'],
  ] as const)('sends a %s email with the right subject', async (purpose, subject) => {
    const mailer = createSmtpMailer(
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'docs@example.com',
        passwordSecretName: 'smtp/password',
      },
      UNUSED_SECRET_RESOLVER,
    )
    await mailer.sendMagicLink({ to: 'ada@example.com', url: 'https://example.com/token', purpose })

    expect(sendMail).toHaveBeenCalledWith({
      from: 'docs@example.com',
      to: 'ada@example.com',
      subject,
      text: expect.stringContaining('https://example.com/token'),
    })
  })

  it('sends the account-exists notice, which says nothing was changed', async () => {
    const mailer = createSmtpMailer(
      {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'docs@example.com',
        passwordSecretName: 'smtp/password',
      },
      UNUSED_SECRET_RESOLVER,
    )
    await mailer.sendAccountExists({
      to: 'ada@example.com',
      signInUrl: 'https://example.com/auth/sign-in',
    })

    expect(sendMail).toHaveBeenCalledWith({
      from: 'docs@example.com',
      to: 'ada@example.com',
      subject: 'You already have an account',
      text: expect.stringContaining('https://example.com/auth/sign-in'),
    })
  })
})
