import { describe, expect, it } from 'vitest'
import { EVENT_PAYLOAD_VERSION, MAIL_REQUESTED } from '@quill/application'

import { createRecordingMailer } from '../../test-support/fakes.ts'
import { createAcknowledgingConsumer } from './acknowledge.ts'
import { createSendMailConsumer, REDACTED_URL } from './send-mail.ts'

/**
 * Delivery is an outbox event because an SMTP round trip on the request path
 * answers "does this address have an account here?" in the latency (ADR-011,
 * review finding H3). The price is that a live token sits in the payload
 * until it is sent, which is why `redactPayload` exists.
 */

const LINK = {
  version: EVENT_PAYLOAD_VERSION,
  kind: 'magic-link' as const,
  to: 'ada@example.com',
  url: 'https://docs.example.com/auth/magic-link#token=live-secret',
  purpose: 'sign-in' as const,
}

describe('createSendMailConsumer', () => {
  it('is registered for MailRequested', () => {
    expect(createSendMailConsumer(createRecordingMailer()).eventType).toBe(MAIL_REQUESTED)
  })

  it('sends a magic link', async () => {
    const mailer = createRecordingMailer()
    await createSendMailConsumer(mailer).handle(LINK)
    expect(mailer.sent).toEqual([{ to: LINK.to, url: LINK.url, purpose: 'sign-in' }])
  })

  it('sends an account-exists notice', async () => {
    const mailer = createRecordingMailer()
    await createSendMailConsumer(mailer).handle({
      version: EVENT_PAYLOAD_VERSION,
      kind: 'account-exists',
      to: 'ada@example.com',
      signInUrl: 'https://docs.example.com/auth/sign-in',
    })
    expect(mailer.accountExists).toEqual([
      { to: 'ada@example.com', signInUrl: 'https://docs.example.com/auth/sign-in' },
    ])
  })

  /** A payload a newer release wrote is left alone rather than failing for ever (ADR-033). */
  it('ignores an event this release cannot read', async () => {
    const mailer = createRecordingMailer()
    await createSendMailConsumer(mailer).handle({ version: 99, kind: 'magic-link' })
    expect(mailer.sent).toEqual([])
  })

  describe('redacting the delivered row', () => {
    it('replaces the link, keeping who it went to and what it was', () => {
      const redacted = createSendMailConsumer(createRecordingMailer()).redactPayload?.(LINK)
      expect(redacted).toEqual({ ...LINK, url: REDACTED_URL })
      expect(JSON.stringify(redacted)).not.toContain('live-secret')
    })

    it('leaves a payload with no credential in it exactly as written', () => {
      const notice = {
        version: EVENT_PAYLOAD_VERSION,
        kind: 'account-exists',
        to: 'ada@example.com',
        signInUrl: 'https://docs.example.com/auth/sign-in',
      }
      const consumer = createSendMailConsumer(createRecordingMailer())
      expect(consumer.redactPayload?.(notice)).toEqual(notice)
      // And an unreadable one, which there is nothing sensible to rewrite.
      expect(consumer.redactPayload?.({ version: 99 })).toEqual({ version: 99 })
    })
  })
})

describe('createAcknowledgingConsumer', () => {
  /**
   * The poller claims only registered types (review finding H6), so a type
   * nothing acts on still needs somebody to mark it processed or the table
   * grows for ever with rows no release will claim.
   */
  it('handles its type by doing nothing, and says why', async () => {
    const consumer = createAcknowledgingConsumer('DocumentCreated', 'the search index is M4')
    expect(consumer.eventType).toBe('DocumentCreated')
    expect(consumer.reason).toBe('the search index is M4')
    await expect(consumer.handle({})).resolves.toBeUndefined()
  })
})
