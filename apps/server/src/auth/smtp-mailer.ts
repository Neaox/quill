import { createTransport } from 'nodemailer'

import type { MagicLinkPurpose } from '@quill/application'

import type { AccountExistsEmail, Mailer, MagicLinkEmail } from './mailer.ts'

export interface SmtpMailerConfig {
  readonly host: string
  readonly port: number
  readonly secure: boolean
  readonly from: string
  readonly user?: string
  readonly pass?: string
}

const SUBJECTS: Readonly<Record<MagicLinkPurpose, string>> = {
  'sign-in': 'Your sign-in link',
  'email-verification': 'Verify your email address',
  'password-reset': 'Reset your password',
}

/** Nodemailer-backed `Mailer`, wired from `ServerConfig.mailer` when its driver is `smtp`. */
export function createSmtpMailer(config: SmtpMailerConfig): Mailer {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user === undefined ? {} : { auth: { user: config.user, pass: config.pass ?? '' } }),
  })

  return {
    async sendMagicLink({ to, url, purpose }: MagicLinkEmail): Promise<void> {
      await transport.sendMail({
        from: config.from,
        to,
        subject: SUBJECTS[purpose],
        text: `${url}\n\nThis link expires in 15 minutes and can only be used once.`,
      })
    },

    async sendAccountExists({ to, signInUrl }: AccountExistsEmail): Promise<void> {
      await transport.sendMail({
        from: config.from,
        to,
        subject: 'You already have an account',
        text:
          'Someone tried to create an account with this email address. ' +
          `You already have one, so nothing has changed — sign in instead:\n\n${signInUrl}\n\n` +
          'If this was not you, you can safely ignore this message.',
      })
    },
  }
}
