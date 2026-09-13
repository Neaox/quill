import type { AccountExistsEmail, Mailer, MagicLinkEmail } from './mailer.ts'

export interface DevMailerLog {
  (message: string): void
}

/** Logs the link instead of sending mail; the default until SMTP is configured (plan §23, open question 6). */
export function createDevMailer(log: DevMailerLog): Mailer {
  return {
    async sendMagicLink({ to, url, purpose }: MagicLinkEmail): Promise<void> {
      log(`[dev-mailer] ${purpose} link for ${to}: ${url}`)
    },
    async sendAccountExists({ to, signInUrl }: AccountExistsEmail): Promise<void> {
      log(`[dev-mailer] account-exists notice for ${to}: ${signInUrl}`)
    },
  }
}
