import { MAIL_REQUESTED, parseMailRequested } from '@quill/application'

import type { Mailer } from '../../auth/mailer.ts'
import type { OutboxConsumer } from './consumer.ts'

/**
 * Delivery, moved off the request path (ADR-011, no account enumeration).
 *
 * An address that has an account used to cost an SMTP round trip that an
 * address without one did not, and a round trip is tens of milliseconds —
 * measurable from anywhere, and a reliable answer to "does this person have
 * an account here?". Queueing the message makes both branches cost a token,
 * a hash and a row, and delivery happens on the job runner afterwards.
 *
 * The price is that a live token sits in `outbox_events.payload` until it is
 * sent, which ADR-011 would otherwise forbid. `redactPayload` is what keeps
 * the rule true in steady state: the poller stores what this returns when it
 * marks the event processed, so the delivered row keeps who and what, and not
 * the credential.
 */

/** What a delivered row says instead of the link. */
export const REDACTED_URL = '[redacted after delivery]'

export function createSendMailConsumer(mailer: Mailer): OutboxConsumer {
  return {
    eventType: MAIL_REQUESTED,

    async handle(payload: unknown): Promise<void> {
      const event = parseMailRequested(payload)
      // An event this release cannot read is left alone rather than failing
      // for ever: the payload carries a version (ADR-033).
      if (event === null) return
      if (event.kind === 'account-exists') {
        await mailer.sendAccountExists({ to: event.to, signInUrl: event.signInUrl })
        return
      }
      await mailer.sendMagicLink({ to: event.to, url: event.url, purpose: event.purpose })
    },

    redactPayload(payload: unknown): unknown {
      const event = parseMailRequested(payload)
      if (event === null || event.kind !== 'magic-link') return payload
      return { ...event, url: REDACTED_URL }
    },
  }
}
