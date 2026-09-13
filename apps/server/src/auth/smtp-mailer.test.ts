import { afterEach, describe, expect, it, vi } from 'vitest'

const sendMail = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
const createTransport = vi
  .fn<(...args: unknown[]) => { sendMail: typeof sendMail }>()
  .mockReturnValue({ sendMail })

vi.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransport(...args),
}))

const { createSmtpMailer } = await import('./smtp-mailer.ts')

describe('createSmtpMailer', () => {
  afterEach(() => {
    createTransport.mockClear()
    sendMail.mockClear()
  })

  it('configures the transport without auth when no user is given', () => {
    createSmtpMailer({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      from: 'docs@example.com',
    })
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
    })
  })

  it('configures the transport with auth when a user is given', () => {
    createSmtpMailer({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      from: 'docs@example.com',
      user: 'user',
      pass: 'pass',
    })
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'user', pass: 'pass' },
    })
  })

  it('defaults the password to an empty string when a user is given without one', () => {
    createSmtpMailer({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      from: 'docs@example.com',
      user: 'user',
    })
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'user', pass: '' } }),
    )
  })

  it.each([
    ['sign-in', 'Your sign-in link'],
    ['email-verification', 'Verify your email address'],
    ['password-reset', 'Reset your password'],
  ] as const)('sends a %s email with the right subject', async (purpose, subject) => {
    const mailer = createSmtpMailer({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      from: 'docs@example.com',
    })
    await mailer.sendMagicLink({ to: 'ada@example.com', url: 'https://example.com/token', purpose })

    expect(sendMail).toHaveBeenCalledWith({
      from: 'docs@example.com',
      to: 'ada@example.com',
      subject,
      text: expect.stringContaining('https://example.com/token'),
    })
  })

  it('sends the account-exists notice, which says nothing was changed', async () => {
    const mailer = createSmtpMailer({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      from: 'docs@example.com',
    })
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
