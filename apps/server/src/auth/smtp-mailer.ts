import { createTransport } from 'nodemailer'
import type { Transporter } from 'nodemailer'

import { BRAND } from '@quill/brand'
import type { MagicLinkPurpose } from '@quill/application'

import type { SecretResolver } from '../infrastructure/secrets/resolve-secret.ts'
import type { AccountExistsEmail, Mailer, MagicLinkEmail } from './mailer.ts'

export interface SmtpMailerConfig {
  readonly host: string
  readonly port: number
  readonly secure: boolean
  readonly from: string
  readonly user?: string
  /** The secret name the SMTP password is stored under (ADR-034). */
  readonly passwordSecretName: string
  /** `SMTP_PASS`, kept only as a fallback for one release. */
  readonly passwordEnvValue?: string
}

const SUBJECTS: Readonly<Record<MagicLinkPurpose, string>> = {
  'sign-in': 'Your sign-in link',
  'email-verification': 'Verify your email address',
  'password-reset': 'Reset your password',
}

/**
 * Nodemailer-backed `Mailer`, wired from `ServerConfig.mailer` when its
 * driver is `smtp`.
 *
 * The password is resolved at the moment of use — each send, not once at
 * startup (ADR-034) — because a transport built once at boot would keep
 * whichever value it was handed for the life of the process, through an
 * administrator rotating the secret and through the fallback's one-release
 * deprecation window. Nodemailer's own connection pooling is not used
 * (`pool` defaults to `false`), so resolving per send costs one lookup, not
 * one connection, per outbound message — this consumer already processes
 * the outbox one row at a time.
 */
export function createSmtpMailer(config: SmtpMailerConfig, secretResolver: SecretResolver): Mailer {
  async function transport(): Promise<Transporter> {
    let pass = ''
    if (config.user !== undefined) {
      const resolved = await secretResolver.resolve({
        name: config.passwordSecretName,
        envVarName: 'SMTP_PASS',
        envValue: config.passwordEnvValue,
      })
      if (!resolved.ok) {
        throw new Error(
          `the SMTP password is not configured: set it with \`${BRAND.slug} secrets:set ` +
            `${config.passwordSecretName}\` (the value is read from stdin, never printed back) ` +
            'or, for now, SMTP_PASS.',
        )
      }
      pass = resolved.value
    }
    return createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user === undefined ? {} : { auth: { user: config.user, pass } }),
    })
  }

  return {
    async sendMagicLink({ to, url, purpose }: MagicLinkEmail): Promise<void> {
      await (
        await transport()
      ).sendMail({
        from: config.from,
        to,
        subject: SUBJECTS[purpose],
        text: `${url}\n\nThis link expires in 15 minutes and can only be used once.`,
      })
    },

    async sendAccountExists({ to, signInUrl }: AccountExistsEmail): Promise<void> {
      await (
        await transport()
      ).sendMail({
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
