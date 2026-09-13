import { describe, expect, it, vi } from 'vitest'

import { createDevMailer } from './dev-mailer.ts'

describe('createDevMailer', () => {
  it('logs the link instead of sending mail', async () => {
    const log = vi.fn<(message: string) => void>()
    const mailer = createDevMailer(log)

    await mailer.sendMagicLink({
      to: 'ada@example.com',
      url: 'https://example.com/token',
      purpose: 'sign-in',
    })

    expect(log).toHaveBeenCalledTimes(1)
    const [message] = log.mock.calls[0] as [string]
    expect(message).toContain('sign-in')
    expect(message).toContain('ada@example.com')
    expect(message).toContain('https://example.com/token')
  })

  it('logs the account-exists notice too, which sign-up sends instead of enumerating', async () => {
    const log = vi.fn<(message: string) => void>()
    const mailer = createDevMailer(log)

    await mailer.sendAccountExists({
      to: 'ada@example.com',
      signInUrl: 'https://example.com/auth/sign-in',
    })

    const [message] = log.mock.calls[0] as [string]
    expect(message).toContain('account-exists')
    expect(message).toContain('ada@example.com')
    expect(message).toContain('https://example.com/auth/sign-in')
  })
})
