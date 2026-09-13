import { describeSecret } from '@quill/application'
import type { SecretsDependencies } from '@quill/application'

/**
 * "Does something name a value for this secret, and can it actually be
 * opened" — checked once, at boot, before the server starts listening
 * (ADR-011, ADR-034), the same way a misconfigured OIDC provider or a
 * missing master key is a boot failure rather than a button that fails when
 * somebody presses it.
 *
 * `describeSecret` only, never `getSecret`: this is an existence check, not a
 * read, so a secret's ciphertext is never opened just to decide whether the
 * server may start. The `keyId` check below is what makes that check worth
 * something: a row can exist and still be unreadable, when a master-key
 * rotation dropped the key that wrapped it, and `describeSecret` alone would
 * call that "configured" and let the failure surface later, at a sign-in or
 * a mail send, on whoever happens to trigger it first.
 *
 * No CLI in this package has a `bin` entry, so every message below spells the
 * full command a person can actually run.
 */

const SECRETS_SET_COMMAND = 'pnpm --filter @quill/server secrets:set'
const SECRETS_ROTATE_COMMAND = 'pnpm --filter @quill/server secrets:rotate'

export interface SecretExistenceCheck {
  /** The secret name the store is checked for. */
  readonly name: string
  /** The environment variable this falls back to, for one release — read at check time, never stored. */
  readonly envVarName: string
  /** What the secret is, for the boot failure and the deprecation warning: "the SMTP password". */
  readonly description: string
}

export interface BootWarn {
  (message: string): void
}

/**
 * Refuses to start when a configured secret names no *readable* value
 * anywhere, and warns once, naming the secret to set, when a check only
 * passes because of its environment fallback.
 *
 * `env` defaults to `process.env` and is a parameter only so a test can
 * supply one without mutating the real environment.
 */
export async function validateSecretsConfigured(
  deps: SecretsDependencies,
  checks: readonly SecretExistenceCheck[],
  warn: BootWarn,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  for (const check of checks) {
    const found = await describeSecret(deps, check.name)
    // Stored is not the same as readable: a row wrapped by a master key this
    // instance no longer holds fails closed here rather than at the moment
    // of use (fail-closed, ADR-034).
    if (found.kind === 'secret' && deps.secrets.keyIds.includes(found.secret.keyId)) continue

    const envValue = env[check.envVarName]
    const hasFallback = envValue !== undefined && envValue.length > 0

    if (found.kind === 'secret') {
      const message =
        `${check.description} is stored under "${check.name}", but no master key this ` +
        `instance holds can open it (key ${found.secret.keyId}). Run ${SECRETS_ROTATE_COMMAND} ` +
        `if that key is only retired, or ${SECRETS_SET_COMMAND} ${check.name} to enter it again.`
      if (hasFallback) {
        warn(`${message} Falling back to ${check.envVarName} for now.`)
        continue
      }
      throw new Error(message)
    }

    if (hasFallback) {
      warn(
        `${check.envVarName} is deprecated: set ${check.description} as a secret instead of an ` +
          `environment variable (${SECRETS_SET_COMMAND} ${check.name}, reading the value from ` +
          `stdin). Reading ${check.envVarName} will stop being supported in a future release.`,
      )
      continue
    }

    throw new Error(
      `${check.description} is not configured: set it with ${SECRETS_SET_COMMAND} ${check.name} ` +
        `(the value is read from stdin, never printed back) or, for now, ${check.envVarName}.`,
    )
  }
}
